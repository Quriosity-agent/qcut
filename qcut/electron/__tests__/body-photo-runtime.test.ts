import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bodyPhotoEnvironment,
	readBodyPhotoSelection,
	resolveBodyPhotoRuntime,
	saveBodyPhotoSelection,
} from "../body-photo/body-photo-runtime";

let root: string;
beforeEach(async () => {
	root = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "body-photo-runtime-test-"))
	);
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

async function bundle({
	platform = "darwin",
}: {
	platform?: NodeJS.Platform;
} = {}) {
	const python =
		platform === "win32"
			? path.join(root, "body", ".venv", "Scripts", "python.exe")
			: path.join(root, "body", ".venv", "bin", "python");
	await Promise.all([
		fs.mkdir(path.join(root, "runtime", "body"), { recursive: true }),
		fs.mkdir(path.join(root, "runtime", "body-portable"), { recursive: true }),
		fs.mkdir(path.dirname(python), { recursive: true }),
	]);
	await fs.writeFile(python, "test executable");
	return python;
}

describe("body-photo local runtime", () => {
	it.each([
		"darwin",
		"linux",
		"win32",
	] as const)("finds the V3 body venv on %s without downloading models", async (platform) => {
		const python = await bundle({ platform });
		expect(
			await resolveBodyPhotoRuntime({ selection: root, platform })
		).toEqual({
			bundleRoot: root,
			runtimeRoot: path.join(root, "runtime"),
			python,
		});
	});
	it("accepts the runtime root and an explicit local Python", async () => {
		const python = await bundle();
		expect(
			await resolveBodyPhotoRuntime({
				selection: path.join(root, "runtime"),
				pythonOverride: python,
			})
		).toMatchObject({ runtimeRoot: path.join(root, "runtime"), python });
	});
	it("rejects missing models, relative paths, and a linked runtime selection", async () => {
		await expect(
			resolveBodyPhotoRuntime({ selection: "relative" })
		).rejects.toThrow("absolute");
		await expect(resolveBodyPhotoRuntime({ selection: root })).rejects.toThrow(
			"containing"
		);
		await bundle();
		const linked = path.join(root, "linked");
		await fs.symlink(
			path.join(root, "runtime"),
			linked,
			process.platform === "win32" ? "junction" : "dir"
		);
		await expect(
			resolveBodyPhotoRuntime({ selection: linked })
		).rejects.toThrow("regular");
	});
	it("cleans Python/native injection variables while retaining OS paths", () => {
		expect(
			bodyPhotoEnvironment({
				environment: {
					PATH: "/safe",
					HOME: "/home",
					DYLD_INSERT_LIBRARIES: "bad",
					LD_PRELOAD: "bad",
					PYTHONPATH: "bad",
					PYTHONHOME: "bad",
					QCUT_NATIVE: "bad",
					BODY_BACKEND: "metal",
					BEAUTY_RUNTIME: "bad",
				},
				runtimeRoot: root,
			})
		).toEqual({
			PATH: "/safe",
			HOME: "/home",
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONUNBUFFERED: "1",
			QCUT_BODY_PHOTO_RUNTIME_ROOT: root,
		});
	});
	it("persists only a bounded local selection and ignores malformed data", async () => {
		const settingsPath = path.join(root, "settings", "body-photo-runtime.json");
		await saveBodyPhotoSelection({ settingsPath, bundleRoot: root });
		expect(await readBodyPhotoSelection({ settingsPath })).toBe(root);
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ bundleRoot: "relative" })
		);
		expect(await readBodyPhotoSelection({ settingsPath })).toBeUndefined();
		await fs.writeFile(settingsPath, "x".repeat(20_000));
		expect(await readBodyPhotoSelection({ settingsPath })).toBeUndefined();
	});
});
