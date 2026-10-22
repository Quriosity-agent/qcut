import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	BODY_PHOTO_CHOOSE_RUNTIME,
	BODY_PHOTO_CLOSE,
	BODY_PHOTO_INSPECT,
	BODY_PHOTO_OPEN,
} from "../body-photo/body-photo-contract";
import type { createBodyPhotoLabService } from "../body-photo/body-photo-service";

const { registrations, showOpenDialog } = vi.hoisted(() => ({
	registrations: new Map<
		string,
		(event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
	>(),
	showOpenDialog: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (
			channel: string,
			listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
		) => registrations.set(channel, listener),
		removeHandler: (channel: string) => registrations.delete(channel),
	},
	dialog: { showOpenDialog },
}));
import { setupBodyPhotoLabIPC } from "../body-photo/body-photo-handler";

function fixture() {
	const mainFrame = {};
	const webContents = { mainFrame, isDestroyed: () => false };
	const window = {
		webContents,
		isDestroyed: () => false,
	} as unknown as BrowserWindow;
	const event = {
		sender: webContents,
		senderFrame: mainFrame,
	} as unknown as IpcMainInvokeEvent;
	const status = { available: false };
	const service = {
		inspect: vi.fn(async () => status),
		open: vi.fn(async () => ({ opened: true as const })),
		close: vi.fn(async () => ({ closed: true })),
		selectRuntime: vi.fn(async () => status),
		dispose: vi.fn(async () => {}),
	} as unknown as ReturnType<typeof createBodyPhotoLabService>;
	return {
		service,
		window,
		event,
		controller: setupBodyPhotoLabIPC({ getMainWindow: () => window, service }),
	};
}
function invoke({
	channel,
	event,
	args = [],
}: {
	channel: string;
	event: IpcMainInvokeEvent;
	args?: unknown[];
}) {
	return Promise.resolve().then(() =>
		registrations.get(channel)?.(event, ...args)
	);
}
beforeEach(() => {
	registrations.clear();
	vi.clearAllMocks();
});

describe("body-photo IPC trust boundary", () => {
	it("exposes only fixed commands to the main window", async () => {
		const { service, event, controller } = fixture();
		await invoke({ channel: BODY_PHOTO_INSPECT, event });
		await invoke({ channel: BODY_PHOTO_OPEN, event });
		await invoke({ channel: BODY_PHOTO_CLOSE, event });
		expect(service.inspect).toHaveBeenCalledOnce();
		expect(service.open).toHaveBeenCalledOnce();
		expect(service.close).toHaveBeenCalledOnce();
		await controller.dispose();
		expect(registrations.size).toBe(0);
		expect(service.dispose).toHaveBeenCalledOnce();
	});
	it.each([
		BODY_PHOTO_INSPECT,
		BODY_PHOTO_OPEN,
		BODY_PHOTO_CLOSE,
		BODY_PHOTO_CHOOSE_RUNTIME,
	])("rejects subframes, foreign senders and arguments for %s", async (channel) => {
		const { service, event } = fixture();
		await expect(
			invoke({
				channel,
				event: { ...event, senderFrame: {} } as IpcMainInvokeEvent,
			})
		).rejects.toThrow("trusted");
		await expect(
			invoke({ channel, event: { ...event, sender: {} } as IpcMainInvokeEvent })
		).rejects.toThrow("trusted");
		await expect(
			invoke({
				channel,
				event,
				args: [{ url: "http://attacker", path: "/arbitrary" }],
			})
		).rejects.toThrow("do not accept");
		expect(service.open).not.toHaveBeenCalled();
		expect(showOpenDialog).not.toHaveBeenCalled();
	});
	it("uses the native folder picker and verifies only its returned selection", async () => {
		const { service, event, window } = fixture();
		showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: ["/chosen-v3"],
		});
		await invoke({ channel: BODY_PHOTO_CHOOSE_RUNTIME, event });
		expect(showOpenDialog).toHaveBeenCalledWith(
			window,
			expect.objectContaining({ properties: ["openDirectory"] })
		);
		expect(service.selectRuntime).toHaveBeenCalledWith({
			selection: "/chosen-v3",
		});
	});
	it("keeps the selection on cancellation and preserves a replacement controller", async () => {
		const old = fixture();
		const current = fixture();
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
		await invoke({ channel: BODY_PHOTO_CHOOSE_RUNTIME, event: current.event });
		expect(current.service.selectRuntime).not.toHaveBeenCalled();
		expect(current.service.inspect).toHaveBeenCalledOnce();
		await old.controller.dispose();
		expect(registrations.size).toBe(4);
		await current.controller.dispose();
	});
	it.each([
		"disposed",
		"replaced",
	] as const)("ignores a native picker result after its controller is %s", async (change) => {
		let complete = (_result: { canceled: boolean; filePaths: string[] }) => {};
		showOpenDialog.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const old = fixture();
		const choosing = invoke({
			channel: BODY_PHOTO_CHOOSE_RUNTIME,
			event: old.event,
		});
		const rejected = expect(choosing).rejects.toThrow("active");
		await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledOnce());
		if (change === "disposed") await old.controller.dispose();
		else fixture();
		complete({ canceled: false, filePaths: ["/chosen-v3"] });
		await rejected;
		expect(old.service.selectRuntime).not.toHaveBeenCalled();
	});
});
