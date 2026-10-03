// @vitest-environment node
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_LIST_CHANNEL,
	BEAUTY_LAB_LOAD_CHANNEL,
} from "../beauty-lab-contract.js";
import {
	BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL,
	BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
} from "../beauty-lab-candidate-contract.js";

const { registrations, ownedFactory, ownedList, ownedLoad } = vi.hoisted(
	() => ({
		registrations: new Map<
			string,
			(event: IpcMainInvokeEvent, request?: unknown) => unknown
		>(),
		ownedFactory: vi.fn(),
		ownedList: vi.fn(),
		ownedLoad: vi.fn(),
	})
);
vi.mock("electron", () => ({
	ipcMain: {
		removeHandler: (channel: string) => registrations.delete(channel),
		handle: (
			channel: string,
			listener: (event: IpcMainInvokeEvent, request?: unknown) => unknown
		) => registrations.set(channel, listener),
	},
}));
vi.mock("../beauty-lab-owned-chain.js", () => ({
	createBeautyLabOwnedChainProvider: ownedFactory,
}));
import { setupBeautyLabIPC } from "../beauty-lab-handler.js";

function context() {
	const mainFrame = {};
	const contents = { mainFrame, isDestroyed: () => false };
	const window = {
		webContents: contents,
		isDestroyed: () => false,
	} as unknown as BrowserWindow;
	return {
		window,
		event: {
			sender: contents,
			senderFrame: mainFrame,
		} as unknown as IpcMainInvokeEvent,
	};
}
async function invoke({
	channel,
	event,
	request,
}: {
	channel: string;
	event: IpcMainInvokeEvent;
	request?: unknown;
}) {
	const listener = registrations.get(channel);
	if (!listener) throw new Error("Missing handler");
	return listener(event, request);
}

beforeEach(() => {
	registrations.clear();
	vi.clearAllMocks();
	ownedList.mockResolvedValue([
		{
			id: "owned-preprocess",
			name: "Owned Preprocess Research Replay",
			frameCount: 7,
		},
	]);
	ownedLoad.mockResolvedValue({ caseId: "owned-preprocess" });
	ownedFactory.mockReturnValue({ list: ownedList, load: ownedLoad });
});

describe("Beauty Lab optional owned-chain research wiring", () => {
	it("does not construct an owned provider by default", async () => {
		const { window, event } = context();
		const cases = [
			{ id: "temporal", name: "Temporal", frameCount: 7 as const },
		];
		const provider = { list: vi.fn(async () => cases), load: vi.fn() };
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			provider,
		});
		expect(await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event })).toBe(
			cases
		);
		expect(ownedFactory).not.toHaveBeenCalled();
	});
	it("aggregates only the optional trusted main-selected owned root", async () => {
		const { window, event } = context();
		const cases = [
			{ id: "temporal", name: "Temporal", frameCount: 7 as const },
			{ id: "qcut-export", name: "Export", frameCount: 7 as const },
		];
		const provider = { list: vi.fn(async () => cases), load: vi.fn() };
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider,
		});
		expect(ownedFactory).toHaveBeenCalledExactlyOnceWith({
			root: "/trusted/owned",
			currentSourceRoot: "/trusted/research",
		});
		expect(await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event })).toEqual([
			...cases,
			{
				id: "owned-preprocess",
				name: "Owned Preprocess Research Replay",
				frameCount: 7,
			},
		]);
		await invoke({
			channel: BEAUTY_LAB_LOAD_CHANNEL,
			event,
			request: { caseId: "owned-preprocess", frameIndex: 2 },
		});
		expect(ownedLoad).toHaveBeenCalledExactlyOnceWith({
			caseId: "owned-preprocess",
			frameIndex: 2,
		});
		expect(provider.load).not.toHaveBeenCalled();
		await invoke({
			channel: BEAUTY_LAB_LOAD_CHANNEL,
			event,
			request: { caseId: "temporal", frameIndex: 3 },
		});
		expect(provider.load).toHaveBeenCalledExactlyOnceWith({
			caseId: "temporal",
			frameIndex: 3,
		});
	});
	it("keeps live candidate unavailable and never substitutes owned replay", async () => {
		const { window, event } = context();
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider: { list: vi.fn(), load: vi.fn() },
		});
		expect(
			await invoke({ channel: BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL, event })
		).toMatchObject({
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
		expect(ownedList).not.toHaveBeenCalled();
		expect(ownedLoad).not.toHaveBeenCalled();
	});
	it("does not fall back after invalid owned evidence", async () => {
		const { window, event } = context();
		const provider = { list: vi.fn(async () => []), load: vi.fn() };
		ownedLoad.mockRejectedValue(new Error("stale evidence"));
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider,
		});
		await expect(
			invoke({
				channel: BEAUTY_LAB_LOAD_CHANNEL,
				event,
				request: { caseId: "owned-preprocess", frameIndex: 0 },
			})
		).rejects.toThrow("stale evidence");
		expect(provider.load).not.toHaveBeenCalled();
	});
	it.each([
		"root",
		"ownedChainRoot",
		"currentSourceRoot",
		"path",
	])("rejects renderer %s input before loading", async (field) => {
		const { window, event } = context();
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider: { list: vi.fn(), load: vi.fn() },
		});
		await expect(
			invoke({
				channel: BEAUTY_LAB_LOAD_CHANNEL,
				event,
				request: {
					caseId: "owned-preprocess",
					frameIndex: 0,
					[field]: "/outside",
				},
			})
		).rejects.toThrow("Invalid Beauty Lab");
		expect(ownedLoad).not.toHaveBeenCalled();
	});
	it("rejects child-frame requests before reading evidence", async () => {
		const { window, event } = context();
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider: { list: vi.fn(), load: vi.fn() },
		});
		await expect(
			invoke({
				channel: BEAUTY_LAB_LIST_CHANNEL,
				event: { ...event, senderFrame: {} } as IpcMainInvokeEvent,
			})
		).rejects.toThrow("trusted main window");
		expect(ownedList).not.toHaveBeenCalled();
	});
	it("omits an unavailable owned case while preserving existing cases", async () => {
		const { window, event } = context();
		const cases = [
			{ id: "temporal", name: "Temporal", frameCount: 7 as const },
		];
		ownedList.mockResolvedValue([]);
		setupBeautyLabIPC({
			getMainWindow: () => window,
			root: "/trusted/temporal",
			currentSourceRoot: "/trusted/research",
			ownedChainRoot: "/trusted/owned",
			provider: { list: vi.fn(async () => cases), load: vi.fn() },
		});
		expect(await invoke({ channel: BEAUTY_LAB_LIST_CHANNEL, event })).toEqual(
			cases
		);
	});
});
