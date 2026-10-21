// @vitest-environment node
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	JIANYING_PORTRAIT_ADJUSTMENT_CANCEL_CHANNEL,
	JIANYING_PORTRAIT_ADJUSTMENT_RENDER_CHANNEL,
} from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider.js";
import {
	parseJianyingPortraitCancelRequest,
	parseJianyingPortraitRenderRequest,
} from "../jianying-portrait-adjustment-runtime/request.js";

const { handlers, removeHandler, handle } = vi.hoisted(() => {
	const handlers = new Map<
		string,
		(event: IpcMainInvokeEvent, request: unknown) => unknown
	>();
	return {
		handlers,
		removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
		handle: vi.fn(
			(
				channel: string,
				listener: (event: IpcMainInvokeEvent, request: unknown) => unknown
			) => handlers.set(channel, listener)
		),
	};
});
vi.mock("electron", () => ({ ipcMain: { handle, removeHandler } }));
import { setupJianyingPortraitAdjustmentIPC } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-handler.js";

beforeEach(() => {
	vi.clearAllMocks();
	handlers.clear();
});

function fixture() {
	const webContents = { isDestroyed: () => false, mainFrame: {} };
	const mainWindow = {
		isDestroyed: () => false,
		webContents,
	} as unknown as BrowserWindow;
	const event = {
		sender: webContents,
		senderFrame: webContents.mainFrame,
	} as unknown as IpcMainInvokeEvent;
	const provider = {
		...createJianyingPortraitAdjustmentProvider(),
		cancel: vi.fn(() => true),
		clear: vi.fn(async () => {}),
		render: vi.fn(),
	};
	const controller = setupJianyingPortraitAdjustmentIPC({
		getMainWindow: () => mainWindow,
		provider,
	});
	const cancel = (
		{
			request,
			from = event,
		}: {
			request?: unknown;
			from?: IpcMainInvokeEvent;
		} = { request: { requestId: "native-1" } }
	) =>
		handlers.get(JIANYING_PORTRAIT_ADJUSTMENT_CANCEL_CHANNEL)!(from, request);
	return { provider, event, controller, cancel };
}

describe("native portrait cancellation IPC", () => {
	it("validates the same bounded identity for render and cancellation", () => {
		const requestId = "native.1:request-2";
		expect(
			parseJianyingPortraitCancelRequest({ request: { requestId } })
		).toEqual({ requestId });
		expect(
			parseJianyingPortraitRenderRequest({
				request: {
					requestId,
					width: 1,
					height: 1,
					rgba: new Uint8Array(4),
					adjustments: { enabled: true, values: {} },
				},
			}).requestId
		).toBe(requestId);
	});
	it.each([
		undefined,
		null,
		5,
		{},
		{ requestId: "" },
		{ requestId: "a\nb" },
		{ requestId: "a".repeat(129) },
	])("rejects invalid cancellation payload %j", (request) => {
		const f = fixture();
		expect(() => f.cancel({ request })).toThrow("requestId");
		expect(f.provider.cancel).not.toHaveBeenCalled();
	});
	it("only allows the trusted main frame to cancel pending work", () => {
		const f = fixture();
		expect(f.cancel()).toBe(true);
		expect(f.provider.cancel).toHaveBeenCalledWith({ requestId: "native-1" });
		for (const from of [
			{ ...f.event, sender: {} },
			{ ...f.event, senderFrame: {} },
			{ ...f.event, senderFrame: null },
		]) {
			expect(() => f.cancel({ from: from as IpcMainInvokeEvent })).toThrow(
				"非主窗口"
			);
		}
		expect(f.provider.cancel).toHaveBeenCalledOnce();
	});
	it("removes cancellation and rendering handlers before clearing the provider", () => {
		const f = fixture();
		f.provider.clear.mockImplementation(async () => {
			expect(handlers.has(JIANYING_PORTRAIT_ADJUSTMENT_CANCEL_CHANNEL)).toBe(
				false
			);
			expect(handlers.has(JIANYING_PORTRAIT_ADJUSTMENT_RENDER_CHANNEL)).toBe(
				false
			);
		});
		f.controller.dispose();
		expect(f.provider.clear).toHaveBeenCalledOnce();
	});
});
