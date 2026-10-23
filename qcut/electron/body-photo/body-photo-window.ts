import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";

export function isBodyPhotoOrigin({
	url,
	origin,
}: {
	url: string;
	origin: string;
}) {
	try {
		const parsed = new URL(url);
		return (
			parsed.origin === origin &&
			parsed.username === "" &&
			parsed.password === ""
		);
	} catch {
		return false;
	}
}

export async function createBodyPhotoWindow({
	origin,
	parent,
	onClosed,
	show = true,
}: {
	origin: string;
	parent: BrowserWindow | null;
	onClosed: () => void;
	show?: boolean;
}): Promise<BrowserWindow> {
	const isolatedSession = session.fromPartition(`body-photo-${randomUUID()}`);
	isolatedSession.setPermissionCheckHandler(() => false);
	isolatedSession.setPermissionRequestHandler(
		(_contents, _permission, callback) => callback(false)
	);
	isolatedSession.webRequest.onBeforeRequest((details, callback) => {
		const localBlob = details.url.startsWith(`blob:${origin}/`);
		const dataImage =
			details.resourceType === "image" && details.url.startsWith("data:image/");
		callback({
			cancel:
				!localBlob &&
				!dataImage &&
				!isBodyPhotoOrigin({ url: details.url, origin }),
		});
	});
	const window = new BrowserWindow({
		title: "QCut · 独立美体照片实验室",
		width: 1360,
		height: 950,
		minWidth: 900,
		minHeight: 650,
		show: false,
		...(parent ? { parent } : {}),
		webPreferences: {
			session: isolatedSession,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			backgroundThrottling: show,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	const preventExternal = (event: Electron.Event, url: string) => {
		if (!isBodyPhotoOrigin({ url, origin })) event.preventDefault();
	};
	window.webContents.on("will-navigate", preventExternal);
	window.webContents.on("will-redirect", preventExternal);
	window.webContents.on("will-frame-navigate", (event) => {
		if (!event.isMainFrame || !isBodyPhotoOrigin({ url: event.url, origin }))
			event.preventDefault();
	});
	window.webContents.on("will-attach-webview", (event) =>
		event.preventDefault()
	);
	window.webContents.once("render-process-gone", () => {
		if (!window.isDestroyed()) window.destroy();
	});
	window.once("closed", () => {
		isolatedSession.webRequest.onBeforeRequest(null);
		onClosed();
	});
	try {
		await window.loadURL(`${origin}/`);
		if (show) window.show();
		return window;
	} catch (error) {
		if (!window.isDestroyed()) window.destroy();
		throw error;
	}
}
