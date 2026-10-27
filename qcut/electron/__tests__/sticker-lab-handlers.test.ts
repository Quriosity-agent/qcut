import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
	discoverLocalReferences: vi.fn(),
	getPath: vi.fn(() => "/mock/videos"),
	readLocalReference: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: mocks.getPath },
	ipcMain: { handle: vi.fn() },
}));

vi.mock("../native-pipeline/stickers/local-reference-catalog/index.js", () => ({
	discoverLocalReferences: mocks.discoverLocalReferences,
	readLocalReference: mocks.readLocalReference,
}));

import { ipcMain } from "electron";
import { registerStickerLabHandlers } from "../main-ipc/sticker-lab-handlers";

function getHandler({
	channel,
}: {
	channel: string;
}): (event: unknown, value?: unknown) => Promise<unknown> {
	const registration = vi
		.mocked(ipcMain.handle)
		.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
	if (!registration) throw new Error(`Missing IPC handler: ${channel}`);
	return registration[1] as (
		event: unknown,
		value?: unknown
	) => Promise<unknown>;
}

describe("Sticker Lab IPC handlers", () => {
	let profile: string;
	beforeEach(() => {
		profile = fs.mkdtempSync(path.join(tmpdir(), "qcut-ipc-sticker-root-"));
		vi.stubEnv("QCUT_USER_DATA_DIR", profile);
		vi.stubEnv("QCUT_STICKER_LAB_ROOT", "");
		vi.clearAllMocks();
		mocks.discoverLocalReferences.mockResolvedValue({
			catalogs: [{}],
			warnings: [],
		});
		mocks.readLocalReference.mockResolvedValue({ bytes: new Uint8Array() });
		registerStickerLabHandlers();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(profile, { recursive: true, force: true });
	});

	it("defaults discovery to the platform videos directory", async () => {
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});

		await discover({}, {});

		expect(mocks.getPath).toHaveBeenCalledWith("videos");
		expect(mocks.discoverLocalReferences).toHaveBeenCalledWith({
			rootPath: path.resolve("/mock/videos", "QCut Sticker Lab"),
		});
	});

	it("reads a persistent root without requiring shell environment inheritance", async () => {
		fs.writeFileSync(
			path.join(profile, "sticker-lab-root.json"),
			JSON.stringify({ version: 1, rootPath: "/external/stickers" })
		);
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});
		await discover({}, {});
		expect(mocks.discoverLocalReferences).toHaveBeenCalledWith({
			rootPath: "/external/stickers",
		});
	});

	it("does not silently use the default root when persistent configuration is corrupt", async () => {
		fs.writeFileSync(path.join(profile, "sticker-lab-root.json"), "broken");
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});
		await expect(discover({}, {})).rejects.toThrow();
		expect(mocks.discoverLocalReferences).not.toHaveBeenCalled();
	});

	it("rejects an unavailable persisted drive instead of discovering a second root", async () => {
		fs.writeFileSync(
			path.join(profile, "sticker-lab-root.json"),
			JSON.stringify({ version: 1, rootPath: "/offline/stickers" })
		);
		mocks.discoverLocalReferences.mockResolvedValue({
			catalogs: [],
			warnings: [{ message: "drive offline" }],
		});
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});
		await expect(discover({}, {})).rejects.toThrow("drive offline");
		expect(mocks.discoverLocalReferences).toHaveBeenCalledTimes(1);
		expect(mocks.discoverLocalReferences).toHaveBeenCalledWith({
			rootPath: "/offline/stickers",
		});
	});

	it("resolves an explicit discovery root without consulting app paths", async () => {
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});

		await discover({}, { rootPath: "/private/stickers" });

		expect(mocks.getPath).not.toHaveBeenCalled();
		expect(mocks.discoverLocalReferences).toHaveBeenCalledWith({
			rootPath: path.resolve("/private/stickers"),
		});
	});

	it("forwards complete read identities", async () => {
		const read = getHandler({ channel: "sticker-lab:read-local-reference" });
		const options = {
			rootPath: "/private/stickers",
			batchId: "jianying-2026-08-23-batch-18-v2",
			stickerId: "123",
		};

		await read({}, options);

		expect(mocks.readLocalReference).toHaveBeenCalledWith(options);
	});

	it("forwards an optional runtime resource name", async () => {
		const read = getHandler({ channel: "sticker-lab:read-local-reference" });
		const options = {
			rootPath: "/private/stickers",
			batchId: "jianying-2026-08-28-batch-99",
			stickerId: "990103",
			resourceName: "runtime/alpha.webm",
		};

		await read({}, options);

		expect(mocks.readLocalReference).toHaveBeenCalledWith(options);
	});

	it("rejects incomplete IPC payloads", async () => {
		const discover = getHandler({
			channel: "sticker-lab:discover-local-references",
		});
		const read = getHandler({ channel: "sticker-lab:read-local-reference" });

		await expect(discover({}, { rootPath: "" })).rejects.toThrow(
			"rootPath must be a non-empty string"
		);
		await expect(
			read({}, { rootPath: "/private/stickers", batchId: "batch" })
		).rejects.toThrow("stickerId must be a non-empty string");
		await expect(
			read(
				{},
				{
					rootPath: "/private/stickers",
					batchId: "batch",
					stickerId: "123",
					resourceName: "",
				}
			)
		).rejects.toThrow("resourceName must be a non-empty string");
	});
});
