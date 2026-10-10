// @vitest-environment node
import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIndependentBeautyJob } from "../beauty-lab/beauty-lab-independent-process";
import {
	independentBeautyPythonPackages,
	verifyIndependentBeautyEnvironment,
} from "../beauty-lab/beauty-lab-runtime-environment";
import { installIndependentBeautyRuntime } from "../beauty-lab-runtime-install";

let root: string;
let sourceRoot: string;
let destination: string;
const manifest = Buffer.from("source-bound manifest");
const bytes = Buffer.from("owned fixture");
const requirements = {
	schemaVersion: 1,
	profile: "fixture",
	sourceManifestSha256: createHash("sha256").update(manifest).digest("hex"),
	files: [
		{
			path: "research/model.bin",
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
	],
};
beforeEach(async () => {
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "beauty-install-"))
	);
	sourceRoot = path.join(root, "source");
	destination = path.join(root, "new", "current");
	await mkdir(path.join(sourceRoot, "research"), { recursive: true });
	await writeFile(path.join(sourceRoot, requirements.files[0].path), bytes);
	await writeFile(path.join(root, "source-manifest.json"), manifest);
});
afterEach(async () => {
	await rm(root, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 100,
	});
});
function setup() {
	const runJob = vi.fn<typeof runIndependentBeautyJob>().mockResolvedValue();
	const verifyEnvironment = vi
		.fn<typeof verifyIndependentBeautyEnvironment>()
		.mockResolvedValue({
			pythonVersion: "3.12",
			packages: independentBeautyPythonPackages,
			cpuInferenceVerified: true,
			compilerExecutionVerified: true,
			metalShaderVerified: true,
			gpuRenderVerified: false,
		});
	const options = {
		sourceRoot,
		destination,
		engineRoot: root,
		basePython: "/base-python",
		uv: "/uv",
		bun: "/bun",
		requirements,
		runJob,
		verifyEnvironment,
	};
	return { options, runJob, verifyEnvironment };
}
describe("external independent runtime installation", () => {
	it("copies a verified payload and creates a fresh venv at its final location", async () => {
		const { options, runJob } = setup();
		const result = await installIndependentBeautyRuntime(options);
		expect(result).toMatchObject({
			verifiedFiles: 1,
			verifiedBytes: bytes.length,
			pixelsRendered: false,
			runtimeRoot: destination,
		});
		expect(
			await readFile(path.join(destination, requirements.files[0].path))
		).toEqual(bytes);
		expect(
			(
				await lstat(path.join(destination, requirements.files[0].path))
			).isSymbolicLink()
		).toBe(false);
		expect(
			JSON.parse(
				await readFile(
					path.join(destination, "installation-receipt.json"),
					"utf8"
				)
			)
		).toEqual(result);
		expect(runJob.mock.calls[0][0].args).toEqual([
			"venv",
			"--python",
			"/base-python",
			"--no-managed-python",
			path.join(destination, ".venv"),
		]);
		await writeFile(
			path.join(destination, requirements.files[0].path),
			"changed"
		);
		expect(
			await readFile(path.join(sourceRoot, requirements.files[0].path))
		).toEqual(bytes);
	});
	it("refuses an existing install without changing its contents", async () => {
		await mkdir(destination, { recursive: true });
		await writeFile(path.join(destination, "keep"), "previous");
		const { options, runJob } = setup();
		await expect(installIndependentBeautyRuntime(options)).rejects.toThrow();
		expect(await readFile(path.join(destination, "keep"), "utf8")).toBe(
			"previous"
		);
		expect(runJob).not.toHaveBeenCalled();
	});
	it("refuses an existing current link and preserves the previous target", async () => {
		await mkdir(path.dirname(destination), { recursive: true });
		await symlink(
			sourceRoot,
			destination,
			process.platform === "win32" ? "junction" : "dir"
		);
		await expect(
			installIndependentBeautyRuntime(setup().options)
		).rejects.toThrow();
		expect(
			await readFile(path.join(sourceRoot, requirements.files[0].path))
		).toEqual(bytes);
	});
	it("rejects corrupted source before creating an installation", async () => {
		await writeFile(
			path.join(sourceRoot, requirements.files[0].path),
			Buffer.alloc(bytes.length)
		);
		await expect(
			installIndependentBeautyRuntime(setup().options)
		).rejects.toThrow("SHA-256");
		await expect(lstat(destination)).rejects.toThrow();
	});
	it("rejects malformed profiles and installations inside their own source", async () => {
		await expect(
			installIndependentBeautyRuntime({
				...setup().options,
				requirements: {
					...requirements,
					files: [{ ...requirements.files[0], path: "research/../../escape" }],
				},
			})
		).rejects.toThrow("profile path");
		await expect(
			installIndependentBeautyRuntime({
				...setup().options,
				destination: path.join(sourceRoot, "install"),
			})
		).rejects.toThrow("outside");
	});
	it.each([
		0, 1, 2,
	])("rolls back owned files when provisioning step %s fails", async (index) => {
		const { options, runJob } = setup();
		runJob.mockImplementation(async (command) => {
			if (runJob.mock.calls.findIndex(([entry]) => entry === command) === index)
				throw new Error("dependency install failed");
		});
		await expect(installIndependentBeautyRuntime(options)).rejects.toThrow(
			"dependency install failed"
		);
		await expect(lstat(destination)).rejects.toThrow();
		expect(
			await readFile(path.join(sourceRoot, requirements.files[0].path))
		).toEqual(bytes);
	});
	it("rolls back if installed dependencies cannot execute", async () => {
		const { options, verifyEnvironment } = setup();
		verifyEnvironment.mockRejectedValue(new Error("CPU inference unavailable"));
		await expect(installIndependentBeautyRuntime(options)).rejects.toThrow(
			"CPU inference unavailable"
		);
		await expect(lstat(destination)).rejects.toThrow();
	});
	it("rechecks payload integrity after dependency provisioning", async () => {
		const { options, runJob } = setup();
		runJob.mockImplementationOnce(async () => {
			await writeFile(
				path.join(destination, requirements.files[0].path),
				Buffer.alloc(bytes.length)
			);
		});
		await expect(installIndependentBeautyRuntime(options)).rejects.toThrow(
			"SHA-256"
		);
		await expect(lstat(destination)).rejects.toThrow();
	});
	it("honors cancellation before creation and after provisioning", async () => {
		const before = new AbortController();
		before.abort();
		await expect(
			installIndependentBeautyRuntime({
				...setup().options,
				signal: before.signal,
			})
		).rejects.toThrow();
		await expect(lstat(destination)).rejects.toThrow();
		const during = new AbortController();
		const { options, runJob } = setup();
		runJob.mockImplementationOnce(async () => {
			during.abort();
			during.signal.throwIfAborted();
		});
		await expect(
			installIndependentBeautyRuntime({ ...options, signal: during.signal })
		).rejects.toThrow();
		await expect(lstat(destination)).rejects.toThrow();
	});
	it("allows only one concurrent installer to own the destination", async () => {
		const results = await Promise.allSettled([
			installIndependentBeautyRuntime(setup().options),
			installIndependentBeautyRuntime(setup().options),
		]);
		expect(
			results.filter((entry) => entry.status === "fulfilled")
		).toHaveLength(1);
		expect(
			await readFile(path.join(destination, requirements.files[0].path))
		).toEqual(bytes);
	});
});
