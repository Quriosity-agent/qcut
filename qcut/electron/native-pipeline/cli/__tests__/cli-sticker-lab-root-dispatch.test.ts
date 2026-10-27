import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("Sticker Lab root command dispatch", () => {
	let temporaryRoot: string;
	let userDataPath: string;
	let stickerRoot: string;
	let configPath: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "qcut-sticker-root-cli-"));
		userDataPath = join(temporaryRoot, "profile");
		stickerRoot = join(temporaryRoot, "external-stickers");
		configPath = join(userDataPath, "sticker-lab-root.json");
		mkdirSync(userDataPath);
		mkdirSync(stickerRoot);
		writeFileSync(join(stickerRoot, "keep.txt"), "keep existing assets");
		writeFileSync(
			configPath,
			JSON.stringify({ version: 1, rootPath: stickerRoot }),
			{ mode: 0o600 }
		);
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	function runRootCommand({ action }: { action: string }) {
		const cliPath = resolve(
			process.cwd(),
			"electron/native-pipeline/cli/cli.ts"
		);
		return spawnSync(
			"bun",
			[cliPath, "sticker-lab", action, "--json", "--quiet"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					QCUT_STICKER_LAB_ROOT: "",
					QCUT_USER_DATA_DIR: userDataPath,
				},
				timeout: 10_000,
			}
		);
	}

	test("reports the saved root without a shell root override or asset scan", () => {
		const result = runRootCommand({ action: "root" });

		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "ok",
			data: {
				command: "sticker-lab-root",
				data: { rootPath: stickerRoot, source: "persisted", configPath },
			},
		});
		expect(existsSync(configPath)).toBe(true);
	});

	test("reset removes only the saved config and preserves the asset directory", () => {
		const result = runRootCommand({ action: "reset-root" });

		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "ok",
			data: {
				command: "sticker-lab-reset-root",
				data: { source: "default", configPath },
			},
		});
		expect(existsSync(configPath)).toBe(false);
		expect(readFileSync(join(stickerRoot, "keep.txt"), "utf8")).toBe(
			"keep existing assets"
		);
	});
});
