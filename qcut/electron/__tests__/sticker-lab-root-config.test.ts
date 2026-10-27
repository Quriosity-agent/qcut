import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
	resetStickerLabRootConfig,
	resolveStickerLabRoot,
	stickerLabRootConfigPath,
	writeStickerLabRootConfig,
} from "../native-pipeline/stickers/sticker-lab-root-config";

describe("persistent Sticker Lab root", () => {
	let temporaryRoot: string;
	let userDataPath: string;
	let library: string;
	beforeEach(async () => {
		temporaryRoot = await realpath(
			fs.mkdtempSync(path.join(tmpdir(), "qcut-sticker-root-"))
		);
		userDataPath = path.join(temporaryRoot, "profile");
		library = path.join(temporaryRoot, "external-library");
		fs.mkdirSync(library);
		library = await realpath(library);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("shares a persisted root with a fresh process environment and leaves no temp files", async () => {
		await writeStickerLabRootConfig({ userDataPath, rootPath: library });
		const resolved = resolveStickerLabRoot({ userDataPath, environment: {} });
		expect(resolved).toEqual({
			rootPath: library,
			source: "persisted",
			configPath: path.join(userDataPath, "sticker-lab-root.json"),
		});
		expect(fs.readdirSync(userDataPath)).toEqual(["sticker-lab-root.json"]);
		if (process.platform !== "win32") {
			expect(fs.statSync(resolved.configPath).mode & 0o777).toBe(0o600);
		}
	});

	it("keeps explicit then environment precedence without reading broken lower-priority configuration", () => {
		fs.mkdirSync(userDataPath);
		fs.writeFileSync(
			path.join(userDataPath, "sticker-lab-root.json"),
			"broken json"
		);
		const environment = { QCUT_STICKER_LAB_ROOT: library };
		expect(
			resolveStickerLabRoot({ userDataPath, environment, root: temporaryRoot })
				.source
		).toBe("explicit");
		expect(resolveStickerLabRoot({ userDataPath, environment }).source).toBe(
			"environment"
		);
		expect(() =>
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toThrow();
	});

	it("uses the platform default only when the config does not exist", () => {
		expect(
			resolveStickerLabRoot({
				userDataPath,
				environment: {},
				videosDirectory: library,
			})
		).toMatchObject({
			source: "default",
			rootPath: path.join(library, "QCut Sticker Lab"),
		});
	});

	it("preserves relative explicit and environment roots without accepting dot segments", () => {
		expect(
			resolveStickerLabRoot({ userDataPath, environment: {}, root: "library" })
		).toMatchObject({ rootPath: path.resolve("library"), source: "explicit" });
		expect(
			resolveStickerLabRoot({
				userDataPath,
				environment: { QCUT_STICKER_LAB_ROOT: "library" },
			})
		).toMatchObject({
			rootPath: path.resolve("library"),
			source: "environment",
		});
		for (const root of ["./library", "library/../other", "library/./nested"]) {
			expect(() =>
				resolveStickerLabRoot({ userDataPath, environment: {}, root })
			).toThrow("without dot segments");
			expect(() =>
				resolveStickerLabRoot({
					userDataPath,
					environment: { QCUT_STICKER_LAB_ROOT: root },
				})
			).toThrow("without dot segments");
		}
	});

	it("honors QCUT_USER_DATA_DIR for GUI and standalone access", async () => {
		const environment = { QCUT_USER_DATA_DIR: userDataPath };
		await writeStickerLabRootConfig({ environment, rootPath: library });
		expect(resolveStickerLabRoot({ environment })).toMatchObject({
			source: "persisted",
			rootPath: library,
		});
	});

	it.each([
		{ version: 2, rootPath: "/library" },
		{ version: 1, rootPath: "relative/library" },
		{ version: 1, rootPath: "/library/../other" },
		{ version: 1, rootPath: "/library", ignored: true },
		{ version: 1, rootPath: 42 },
	])("rejects invalid configuration instead of falling back: %j", (candidate) => {
		fs.mkdirSync(userDataPath);
		fs.writeFileSync(
			path.join(userDataPath, "sticker-lab-root.json"),
			JSON.stringify(candidate)
		);
		expect(() =>
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toThrow();
	});

	it("does not substitute a default when the configured drive is unavailable", async () => {
		await writeStickerLabRootConfig({ userDataPath, rootPath: library });
		fs.rmdirSync(library);
		expect(
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toMatchObject({ source: "persisted", rootPath: library });
	});

	it("rejects a symlink library and preserves the previous selection", async () => {
		await writeStickerLabRootConfig({ userDataPath, rootPath: library });
		const link = path.join(temporaryRoot, "alias");
		fs.symlinkSync(library, link, "dir");
		await expect(
			writeStickerLabRootConfig({ userDataPath, rootPath: link })
		).rejects.toThrow("non-symlink");
		expect(
			resolveStickerLabRoot({ userDataPath, environment: {} }).rootPath
		).toBe(library);
	});

	it("rejects symlink and oversized config files", () => {
		fs.mkdirSync(userDataPath);
		const target = path.join(temporaryRoot, "other.json");
		fs.writeFileSync(target, JSON.stringify({ version: 1, rootPath: library }));
		const configPath = stickerLabRootConfigPath({ userDataPath });
		fs.symlinkSync(target, configPath);
		expect(() =>
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toThrow("Invalid Sticker Lab configuration");
		fs.unlinkSync(configPath);
		fs.writeFileSync(configPath, " ".repeat(16 * 1024 + 1));
		expect(() =>
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toThrow("Invalid Sticker Lab configuration");
	});

	it("reset removes only the config and is idempotent", async () => {
		await writeStickerLabRootConfig({ userDataPath, rootPath: library });
		const sentinel = path.join(library, "keep.txt");
		fs.writeFileSync(sentinel, "keep");
		resetStickerLabRootConfig({ userDataPath });
		resetStickerLabRootConfig({ userDataPath });
		expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
		expect(
			resolveStickerLabRoot({ userDataPath, environment: {} }).source
		).toBe("default");
	});

	it("bounds the read even when the file grows after its identity check", async () => {
		await writeStickerLabRootConfig({ userDataPath, rootPath: library });
		const configPath = stickerLabRootConfigPath({ userDataPath });
		const originalStat = fs.fstatSync.bind(fs);
		vi.spyOn(fs, "fstatSync").mockImplementation((descriptor) => {
			const stats = originalStat(descriptor);
			fs.appendFileSync(configPath, " ".repeat(64 * 1024));
			return stats;
		});
		const read = vi.spyOn(fs, "readSync");
		expect(() =>
			resolveStickerLabRoot({ userDataPath, environment: {} })
		).toThrow("exceeds the size limit");
		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(
			expect.any(Number),
			expect.any(Buffer),
			0,
			16 * 1024 + 1,
			0
		);
	});
});
