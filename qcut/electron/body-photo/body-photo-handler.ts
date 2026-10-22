import {
	dialog,
	ipcMain,
	type BrowserWindow,
	type IpcMainInvokeEvent,
} from "electron";
import {
	BODY_PHOTO_CHOOSE_RUNTIME,
	BODY_PHOTO_CLOSE,
	BODY_PHOTO_INSPECT,
	BODY_PHOTO_OPEN,
} from "./body-photo-contract.js";
import type { createBodyPhotoLabService } from "./body-photo-service.js";

let activeController: symbol | undefined;
export function setupBodyPhotoLabIPC({
	getMainWindow,
	service,
}: {
	getMainWindow: () => BrowserWindow | null;
	service: ReturnType<typeof createBodyPhotoLabService>;
}) {
	const identity = Symbol("body-photo-lab");
	activeController = identity;
	const channels = [
		BODY_PHOTO_INSPECT,
		BODY_PHOTO_OPEN,
		BODY_PHOTO_CLOSE,
		BODY_PHOTO_CHOOSE_RUNTIME,
	];
	function trustedWindow({
		event,
		args,
	}: {
		event: IpcMainInvokeEvent;
		args: unknown[];
	}) {
		const window = getMainWindow();
		if (
			!window ||
			window.isDestroyed() ||
			window.webContents.isDestroyed() ||
			event.sender !== window.webContents ||
			!event.senderFrame ||
			event.senderFrame !== window.webContents.mainFrame
		)
			throw new Error("Body-photo laboratory requires the trusted main window");
		if (args.length !== 0)
			throw new Error(
				"Body-photo commands do not accept renderer supplied paths or URLs"
			);
		return window;
	}
	for (const channel of channels) ipcMain.removeHandler(channel);
	ipcMain.handle(BODY_PHOTO_INSPECT, (event, ...args: unknown[]) => {
		trustedWindow({ event, args });
		return service.inspect();
	});
	ipcMain.handle(BODY_PHOTO_OPEN, (event, ...args: unknown[]) => {
		trustedWindow({ event, args });
		return service.open();
	});
	ipcMain.handle(BODY_PHOTO_CLOSE, (event, ...args: unknown[]) => {
		trustedWindow({ event, args });
		return service.close();
	});
	ipcMain.handle(
		BODY_PHOTO_CHOOSE_RUNTIME,
		async (event, ...args: unknown[]) => {
			const window = trustedWindow({ event, args });
			const result = await dialog.showOpenDialog(window, {
				title: "选择本地 V3 美体照片运行目录",
				properties: ["openDirectory"],
			});
			trustedWindow({ event, args });
			if (result.canceled || result.filePaths.length !== 1)
				return service.inspect();
			return service.selectRuntime({ selection: result.filePaths[0] });
		}
	);
	let disposal: Promise<void> | undefined;
	return {
		dispose() {
			disposal ??= (async () => {
				if (activeController === identity) {
					for (const channel of channels) ipcMain.removeHandler(channel);
					activeController = undefined;
				}
				await service.dispose();
			})();
			return disposal;
		},
	};
}
