import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindowConstructorOptions } from "electron";

const mocked = vi.hoisted(() => ({
	windows: [] as unknown[],
	options: [] as BrowserWindowConstructorOptions[],
	requestHandler: vi.fn(),
	permission: vi.fn(),
	permissions: vi.fn(),
	failLoad: false,
}));
vi.mock("electron", () => ({
	session: {
		fromPartition: vi.fn(() => ({
			setPermissionCheckHandler: mocked.permission,
			setPermissionRequestHandler: mocked.permissions,
			webRequest: { onBeforeRequest: mocked.requestHandler },
		})),
	},
	BrowserWindow: class extends EventEmitter {
		webContents = Object.assign(new EventEmitter(), {
			setWindowOpenHandler: vi.fn(),
		});
		destroyed = false;
		show = vi.fn();
		constructor(options: BrowserWindowConstructorOptions) {
			super();
			mocked.windows.push(this);
			mocked.options.push(options);
		}
		isDestroyed() {
			return this.destroyed;
		}
		destroy() {
			this.destroyed = true;
			this.emit("closed");
		}
		loadURL = vi.fn(async () => {
			if (mocked.failLoad) throw new Error("failed load");
		});
	},
}));
import {
	createBodyPhotoWindow,
	isBodyPhotoOrigin,
} from "../body-photo/body-photo-window";

const origin = "http://127.0.0.1:54321";
beforeEach(() => {
	mocked.windows.length = 0;
	mocked.options.length = 0;
	mocked.failLoad = false;
	vi.clearAllMocks();
});

describe("body-photo isolated window", () => {
	it.each([
		"http://127.0.0.1:54322/",
		"http://localhost:54321/",
		"http://127.0.0.1:54321.evil.test/",
		"file:///tmp/secret",
		"javascript:alert(1)",
		"http://user:pass@127.0.0.1:54321/",
	])("rejects a different origin or protocol: %s", (url) => {
		expect(isBodyPhotoOrigin({ url, origin })).toBe(false);
	});
	it("keeps the owned origin usable and removes all Node/preload privileges", async () => {
		const onClosed = vi.fn();
		const window = await createBodyPhotoWindow({
			origin,
			parent: null,
			onClosed,
		});
		expect(mocked.options[0].webPreferences).toMatchObject({
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
		});
		expect(mocked.options[0].webPreferences).not.toHaveProperty("preload");
		const openHandler = vi.mocked(window.webContents.setWindowOpenHandler).mock
			.calls[0][0];
		expect(openHandler({} as Electron.HandlerDetails)).toEqual({
			action: "deny",
		});
		const event = { preventDefault: vi.fn() };
		window.webContents.emit("will-navigate", event, `${origin}/`);
		expect(event.preventDefault).not.toHaveBeenCalled();
		window.webContents.emit("will-redirect", event, "https://example.com");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		window.webContents.emit("render-process-gone");
		expect(window.isDestroyed()).toBe(true);
		expect(onClosed).toHaveBeenCalledOnce();
	});
	it("blocks network exfiltration while allowing own fetch, original blobs and data images", async () => {
		await createBodyPhotoWindow({ origin, parent: null, onClosed: vi.fn() });
		const handler = mocked.requestHandler.mock.calls[0][0];
		for (const [url, resourceType, cancel] of [
			[`${origin}/api/render`, "xhr", false],
			[`blob:${origin}/id`, "image", false],
			["data:image/png;base64,a", "image", false],
			["https://example.com/upload", "xhr", true],
			["file:///etc/passwd", "image", true],
			["data:text/html,hi", "subFrame", true],
		] as const) {
			const callback = vi.fn();
			handler({ url, resourceType }, callback);
			expect(callback).toHaveBeenCalledWith({ cancel });
		}
	});
	it("destroys a failed startup window and releases its session guard", async () => {
		mocked.failLoad = true;
		const onClosed = vi.fn();
		await expect(
			createBodyPhotoWindow({ origin, parent: null, onClosed })
		).rejects.toThrow("failed load");
		expect(onClosed).toHaveBeenCalledOnce();
		expect(mocked.requestHandler).toHaveBeenLastCalledWith(null);
	});
	it("keeps automated validation hidden", async () => {
		const window = await createBodyPhotoWindow({
			origin,
			parent: null,
			onClosed: vi.fn(),
			show: false,
		});
		expect(window.show).not.toHaveBeenCalled();
		expect(mocked.options[0].webPreferences).toHaveProperty(
			"backgroundThrottling",
			false
		);
	});
});
