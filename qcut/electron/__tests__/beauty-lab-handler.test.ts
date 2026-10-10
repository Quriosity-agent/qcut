// @vitest-environment node
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_LIST_CHANNEL,
	BEAUTY_LAB_LOAD_CHANNEL,
	type BeautyLabResearchCase,
	type BeautyLabResearchFrame,
} from "../beauty-lab/beauty-lab-contract.js";
import { createBeautyLabResearchProvider } from "../beauty-lab/beauty-lab-research.js";
import { createBeautyLabCandidateProvider } from "../beauty-lab/beauty-lab-candidate-provider.js";
import {
	BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL,
	BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL,
	BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
} from "../beauty-lab/beauty-lab-candidate-contract.js";

const { registrations, handle, removeHandler } = vi.hoisted(() => {
	const registrations = new Map<
		string,
		(event: IpcMainInvokeEvent, request?: unknown) => unknown
	>();
	return {
		registrations,
		handle: vi.fn(
			(
				channel: string,
				listener: (event: IpcMainInvokeEvent, request?: unknown) => unknown
			) => {
				if (registrations.has(channel))
					throw new Error("Duplicate IPC registration");
				registrations.set(channel, listener);
			}
		),
		removeHandler: vi.fn((channel: string) => {
			registrations.delete(channel);
		}),
	};
});

vi.mock("electron", () => ({ ipcMain: { handle, removeHandler } }));

import {
	BEAUTY_LAB_INDEPENDENT_INSPECT,
	BEAUTY_LAB_INDEPENDENT_RENDER,
	BEAUTY_LAB_INDEPENDENT_CANCEL,
} from "../beauty-lab/beauty-lab-independent-contract";
import { createBeautyLabIndependentProvider } from "../beauty-lab/beauty-lab-independent";

import { setupBeautyLabIPC } from "../beauty-lab/beauty-lab-handler.js";

const cases: BeautyLabResearchCase[] = [
	{ id: "temporal", name: "Temporal", frameCount: 7 },
];
const frame: BeautyLabResearchFrame = {
	caseId: "temporal",
	frameIndex: 0,
	width: 1448,
	height: 1086,
	input: new Uint8Array([1, 2, 3, 255]),
	native: new Uint8Array([4, 5, 6, 255]),
	candidate: new Uint8Array([4, 5, 6, 255]),
	adjustments: { enabled: true, values: { face_adjust_eye: 100 } },
	source: "verified-offline-replay",
	sourceHashesVerified: true,
	nativeDependencies: true,
};

function context() {
	const mainFrame = {};
	const webContents = { isDestroyed: vi.fn(() => false), mainFrame };
	const window = { isDestroyed: vi.fn(() => false), webContents };
	const event = {
		sender: webContents,
		senderFrame: mainFrame,
	} as unknown as IpcMainInvokeEvent;
	return { window, event, mainWindow: window as unknown as BrowserWindow };
}

function provider() {
	return {
		list: vi.fn(async () => cases),
		load: vi.fn(
			async (_request: { caseId: string; frameIndex: number }) => frame
		),
	};
}

function invoke({
	channel,
	event,
	request,
}: {
	channel: string;
	event: IpcMainInvokeEvent;
	request?: unknown;
}): Promise<unknown> {
	const listener = registrations.get(channel);
	if (!listener) return Promise.reject(new Error("Missing IPC registration"));
	return Promise.resolve().then(() => listener(event, request));
}

beforeEach(() => {
	registrations.clear();
	vi.clearAllMocks();
});

describe("Beauty Lab IPC", () => {
	it("exposes unavailable candidate capability without silently using replay or native", async () => {
		const { event, mainWindow } = context();
		const research = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		expect(
			await invoke({ channel: BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL, event })
		).toMatchObject({
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			available: false,
			state: "not-connected",
			backendVersion: null,
		});
		await expect(
			invoke({
				channel: BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
				event,
				request: {},
			})
		).rejects.toThrow("backend unavailable");
		expect(research.load).not.toHaveBeenCalled();
		expect(research.list).not.toHaveBeenCalled();
	});

	it("passes candidate requests to the candidate provider, not the research loader", async () => {
		const { event, mainWindow } = context();
		const research = provider();
		const candidateProvider = {
			inspect: vi.fn(),
			dispose: vi.fn(async () => {}),
			render: vi.fn(async () => {
				throw new Error("candidate-driver-test");
			}),
		};
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
			candidateProvider,
		});
		const request = { requestId: "test" };
		await expect(
			invoke({ channel: BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL, event, request })
		).rejects.toThrow("candidate-driver-test");
		expect(candidateProvider.render).toHaveBeenCalledExactlyOnceWith({
			request,
		});
		expect(research.load).not.toHaveBeenCalled();
	});
	it("passes trusted cancellations to the candidate provider unchanged", async () => {
		const { event, mainWindow } = context();
		const research = provider();
		const candidateProvider = {
			inspect: vi.fn(),
			render: vi.fn(),
			cancel: vi.fn(() => ({ cancelled: true })),
			dispose: vi.fn(async () => {}),
		};
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
			candidateProvider,
		});
		const request = { requestId: "test" };
		expect(
			await invoke({
				channel: BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL,
				event,
				request,
			})
		).toEqual({ cancelled: true });
		expect(candidateProvider.cancel).toHaveBeenCalledExactlyOnceWith({
			request,
		});
		expect(candidateProvider.render).not.toHaveBeenCalled();
		expect(research.load).not.toHaveBeenCalled();
	});
	it("passes trusted calls and returns the provider's metadata and byte arrays unchanged", async () => {
		const { event, mainWindow } = context();
		const research = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		expect(await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event })).toBe(
			cases
		);
		expect(
			await invoke({
				channel: BEAUTY_LAB_LOAD_CHANNEL,
				event,
				request: { caseId: "temporal", frameIndex: 0 },
			})
		).toBe(frame);
		expect(research.list).toHaveBeenCalledExactlyOnceWith();
		expect(research.load).toHaveBeenCalledExactlyOnceWith({
			caseId: "temporal",
			frameIndex: 0,
		});
	});

	it.each([
		"missing-window",
		"destroyed-window",
		"destroyed-contents",
		"foreign-sender",
		"missing-frame",
		"child-frame",
	])("rejects %s for all channels before any provider work", async (failure) => {
		const { event, window, mainWindow } = context();
		const research = provider();
		const candidateProvider = {
			inspect: vi.fn(),
			render: vi.fn(),
			cancel: vi.fn(),
			dispose: vi.fn(async () => {}),
		};
		const untrusted = { ...event };
		if (failure === "destroyed-window")
			window.isDestroyed.mockReturnValue(true);
		if (failure === "destroyed-contents")
			window.webContents.isDestroyed.mockReturnValue(true);
		if (failure === "foreign-sender")
			untrusted.sender = {} as IpcMainInvokeEvent["sender"];
		if (failure === "missing-frame") untrusted.senderFrame = null;
		if (failure === "child-frame")
			untrusted.senderFrame = {} as IpcMainInvokeEvent["senderFrame"];
		setupBeautyLabIPC({
			getMainWindow: () => (failure === "missing-window" ? null : mainWindow),
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
			candidateProvider,
		});
		await expect(
			invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event: untrusted })
		).rejects.toThrow("trusted main window");
		await expect(
			invoke({
				channel: BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL,
				event: untrusted,
			})
		).rejects.toThrow("trusted main window");
		await expect(
			invoke({
				channel: BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
				event: untrusted,
				request: {},
			})
		).rejects.toThrow("trusted main window");
		await expect(
			invoke({
				channel: BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL,
				event: untrusted,
				request: { requestId: "test" },
			})
		).rejects.toThrow("trusted main window");
		for (const channel of [
			BEAUTY_LAB_INDEPENDENT_INSPECT,
			BEAUTY_LAB_INDEPENDENT_RENDER,
			BEAUTY_LAB_INDEPENDENT_CANCEL,
		]) {
			await expect(
				invoke({ channel, event: untrusted, request: {} })
			).rejects.toThrow("trusted main window");
		}
		expect(candidateProvider.inspect).not.toHaveBeenCalled();
		expect(candidateProvider.render).not.toHaveBeenCalled();
		expect(candidateProvider.cancel).not.toHaveBeenCalled();
		await expect(
			invoke({
				channel: BEAUTY_LAB_LOAD_CHANNEL,
				event: untrusted,
				request: { caseId: "temporal", frameIndex: 0 },
			})
		).rejects.toThrow("trusted main window");
		expect(research.list).not.toHaveBeenCalled();
		expect(research.load).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		null,
		true,
		false,
		0,
		"temporal",
		[],
		["temporal", 0],
		{},
		{ caseId: 0, frameIndex: 0 },
		{ caseId: "temporal" },
		...[true, false, "0", null, NaN, Infinity, -Infinity, -1, 7, 0.5].map(
			(frameIndex) => ({ caseId: "temporal", frameIndex })
		),
	])("rejects malformed request %j without calling the provider", async (request) => {
		const { event, mainWindow } = context();
		const research = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		await expect(
			invoke({ channel: BEAUTY_LAB_LOAD_CHANNEL, event, request })
		).rejects.toThrow("Invalid Beauty Lab");
		expect(research.load).not.toHaveBeenCalled();
	});

	it.each([0, 6])("accepts bounded frame index %s", async (frameIndex) => {
		const { event, mainWindow } = context();
		const research = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		await invoke({
			channel: BEAUTY_LAB_LOAD_CHANNEL,
			event,
			request: { caseId: "temporal", frameIndex },
		});
		expect(research.load).toHaveBeenCalledExactlyOnceWith({
			caseId: "temporal",
			frameIndex,
		});
	});

	it.each([
		"unknown",
		"../campaign-00",
		"/campaign-00",
		"__proto__",
	])("propagates whitelist rejection for %s", async (caseId) => {
		const { event, mainWindow } = context();
		const research = createBeautyLabResearchProvider({
			root: "/nonexistent",
			currentSourceRoot: "/nonexistent",
		});
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		await expect(
			invoke({
				channel: BEAUTY_LAB_LOAD_CHANNEL,
				event,
				request: { caseId, frameIndex: 0 },
			})
		).rejects.toThrow("unknown case id");
	});

	it("rechecks the active window at invocation time", async () => {
		const first = context();
		const second = context();
		let mainWindow = first.mainWindow;
		const research = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
		});
		mainWindow = second.mainWindow;
		await expect(
			invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event: first.event })
		).rejects.toThrow("trusted main window");
		expect(
			await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event: second.event })
		).toBe(cases);
	});

	it("replaces previous handlers without duplicate registrations", async () => {
		const { event, mainWindow } = context();
		const first = provider();
		const second = provider();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: first,
		});
		const replacement = setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: second,
		});
		await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event });
		await invoke({
			channel: BEAUTY_LAB_LOAD_CHANNEL,
			event,
			request: { caseId: "temporal", frameIndex: 0 },
		});
		expect(first.list).not.toHaveBeenCalled();
		expect(first.load).not.toHaveBeenCalled();
		expect(second.list).toHaveBeenCalledOnce();
		expect(second.load).toHaveBeenCalledOnce();
		await replacement.dispose();
		await replacement.dispose();
		expect(registrations.size).toBe(0);
	});

	it("does not let a stale controller dispose replacement handlers", async () => {
		const { event, mainWindow } = context();
		const first = setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: provider(),
		});
		const second = provider();
		const replacement = setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: second,
		});
		await first.dispose();
		expect(registrations.has(BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL)).toBe(true);
		expect(registrations.has(BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL)).toBe(true);
		expect(await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event })).toBe(
			cases
		);
		await invoke({
			channel: BEAUTY_LAB_LOAD_CHANNEL,
			event,
			request: { caseId: "temporal", frameIndex: 0 },
		});
		expect(second.list).toHaveBeenCalledOnce();
		expect(second.load).toHaveBeenCalledOnce();
		await replacement.dispose();
		expect(registrations.size).toBe(0);
	});
	it.each([
		false,
		true,
	])("awaits candidate cleanup once even when stale=%s", async (stale) => {
		const { mainWindow } = context();
		let finish = () => {};
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const candidateProvider = {
			...createBeautyLabCandidateProvider(),
			dispose: vi.fn(() => pending),
		};
		const options = {
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: provider(),
		};
		const first = setupBeautyLabIPC({ ...options, candidateProvider });
		const replacement = stale ? setupBeautyLabIPC(options) : undefined;
		const disposal = first.dispose();
		expect(first.dispose()).toBe(disposal);
		let settled = false;
		void disposal.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(candidateProvider.dispose).toHaveBeenCalledOnce();
		expect(settled).toBe(false);
		expect(registrations.size).toBe(stale ? 8 : 0);
		finish();
		await disposal;
		expect(settled).toBe(true);
		await replacement?.dispose();
	});
	it("returns cleanup failure to the quit barrier after removing handlers", async () => {
		const { mainWindow } = context();
		const controller = setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: provider(),
			candidateProvider: {
				...createBeautyLabCandidateProvider(),
				dispose: vi.fn(async () => {
					throw new Error("cleanup failed");
				}),
			},
		});
		await expect(controller.dispose()).rejects.toThrow("cleanup failed");
		expect(registrations.size).toBe(0);
	});
});

describe("independent Beauty Lab IPC", () => {
	it("dispatches only to the independent provider and awaits its disposal", async () => {
		const { event, mainWindow } = context();
		const owned = {
			...createBeautyLabIndependentProvider({ engineRoot: "/unused" }),
			inspect: vi.fn(async () => ({
				available: false,
				provider: "qcut-independent-photo-v1" as const,
				message: "test",
				controls: [],
				makeupCards: [],
			})),
			render: vi.fn(async () => {
				throw new Error("owned-only");
			}),
			cancel: vi.fn(() => ({ cancelled: true })),
			dispose: vi.fn(async () => {}),
		};
		const research = provider();
		const controller = setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: research,
			independentProvider: owned,
		});
		expect(
			await invoke({ channel: BEAUTY_LAB_INDEPENDENT_INSPECT, event })
		).toMatchObject({ available: false });
		await expect(
			invoke({ channel: BEAUTY_LAB_INDEPENDENT_RENDER, event, request: {} })
		).rejects.toThrow("owned-only");
		expect(
			await invoke({
				channel: BEAUTY_LAB_INDEPENDENT_CANCEL,
				event,
				request: { requestId: "one" },
			})
		).toEqual({ cancelled: true });
		expect(owned.cancel).toHaveBeenCalledWith({
			request: { requestId: "one" },
		});
		expect(research.load).not.toHaveBeenCalled();
		await controller.dispose();
		await controller.dispose();
		expect(owned.dispose).toHaveBeenCalledOnce();
		expect(registrations.size).toBe(0);
	});
	it("fails clearly if the independent provider is not connected", async () => {
		const { event, mainWindow } = context();
		setupBeautyLabIPC({
			getMainWindow: () => mainWindow,
			root: "/unused",
			currentSourceRoot: "/unused",
			provider: provider(),
		});
		for (const channel of [
			BEAUTY_LAB_INDEPENDENT_INSPECT,
			BEAUTY_LAB_INDEPENDENT_RENDER,
			BEAUTY_LAB_INDEPENDENT_CANCEL,
		]) {
			await expect(invoke({ channel, event, request: {} })).rejects.toThrow(
				"not connected"
			);
		}
	});
});
