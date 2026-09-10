import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import manifest from "../rife/rife-binaries.json";
import {
	interpolateFrameDirectory,
	RIFE_EXECUTABLE,
	RIFE_MODEL,
	RIFE_RELEASE,
} from "../rife/rife-bridge";

describe("rife bridge", () => {
	let inputDir = "";
	let outputDir = "";

	beforeEach(async () => {
		inputDir = await mkdtemp(path.join(os.tmpdir(), "qcut-rife-in-"));
		outputDir = await mkdtemp(path.join(os.tmpdir(), "qcut-rife-out-"));
	});
	afterEach(async () => {
		await rm(inputDir, { recursive: true, force: true });
		await rm(outputDir, { recursive: true, force: true });
	});

	it("exposes the pinned release, model and platform executable name", () => {
		expect(RIFE_RELEASE).toBe(manifest.release);
		expect(RIFE_MODEL).toBe("rife-v4.6");
		expect(RIFE_EXECUTABLE).toBe(
			process.platform === "win32" ? "rife-ncnn-vulkan.exe" : "rife-ncnn-vulkan"
		);
		// Every pinned target ships the same single model.
		for (const target of Object.values(manifest.targets)) {
			expect(target.modelDir.endsWith(`/${manifest.model}`)).toBe(true);
			expect(Object.keys(target.modelFiles).sort()).toEqual([
				"flownet.bin",
				"flownet.param",
			]);
		}
	});

	// Argument validation runs before the host is resolved, so these hold
	// whether or not RIFE binaries are staged on the machine running the suite.
	it("rejects an impossible target frame count before touching the host", async () => {
		await expect(
			interpolateFrameDirectory({ inputDir, outputDir, targetFrameCount: 1 })
		).rejects.toThrow(RangeError);
		await expect(
			interpolateFrameDirectory({ inputDir, outputDir, targetFrameCount: 2.5 })
		).rejects.toThrow(RangeError);
	});

	it("refuses to interpolate fewer than two frames", async () => {
		await writeFile(path.join(inputDir, "00000001.png"), "");
		await writeFile(path.join(inputDir, "not-a-frame.png"), "");
		await expect(
			interpolateFrameDirectory({ inputDir, outputDir, targetFrameCount: 4 })
		).rejects.toThrow(/at least two input frames, found 1/);
	});
});
