// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runIndependentBeautyJob } from "../beauty-lab-independent-process";
import {
	independentBeautyEnvironment,
	independentBeautyPythonPackages,
	verifyIndependentBeautyEnvironment,
} from "../beauty-lab-runtime-environment";

describe("independent runtime environment", () => {
	it("keeps package pins aligned with the source-bound setup", async () => {
		const setup = await readFile(
			new URL(
				"../../research/independent-beauty/research/setup.sh",
				import.meta.url
			),
			"utf8"
		);
		for (const [name, version] of Object.entries(
			independentBeautyPythonPackages
		))
			expect(setup).toContain(`${name}==${version}`);
		expect(setup).toContain("--python 3.12");
	});
	it("strips inherited Python and native library injection without mutating the caller", () => {
		const environment = {
			PATH: "/tools",
			DYLD_LIBRARY_PATH: "native",
			DYLD_INSERT_LIBRARIES: "native",
			PYTHONPATH: "injected",
			PYTHONHOME: "injected",
			PYTHONDONTWRITEBYTECODE: "0",
		};
		expect(independentBeautyEnvironment({ environment })).toEqual({
			PATH: "/tools",
			PYTHONDONTWRITEBYTECODE: "1",
		});
		expect(environment.PYTHONPATH).toBe("injected");
	});
	it("executes inference, planner and runtime shader probes with bounded jobs", async () => {
		const runJob = vi.fn<typeof runIndependentBeautyJob>().mockResolvedValue();
		const signal = new AbortController().signal;
		const result = await verifyIndependentBeautyEnvironment({
			python: "/python",
			bun: "/bun",
			cwd: "/engine",
			signal,
			environment: { PYTHONPATH: "bad" },
			runJob,
		});
		expect(result).toMatchObject({
			cpuInferenceVerified: true,
			metalShaderVerified: true,
			gpuRenderVerified: false,
		});
		expect(runJob).toHaveBeenCalledTimes(4);
		for (const [command] of runJob.mock.calls)
			expect(command).toMatchObject({
				cwd: "/engine",
				signal,
				timeoutMs: 30_000,
				environment: { PYTHONDONTWRITEBYTECODE: "1" },
			});
		const python = runJob.mock.calls[0][0];
		expect(python.args.slice(0, 3)).toEqual(["-I", "-B", "-c"]);
		expect(python.args[3]).toContain("InferenceSession");
		expect(runJob.mock.calls[3][0].args.join(" ")).toContain("makeLibrary");
	});
	it.each([
		{ index: 0, name: "Python packages / CPU inference" },
		{ index: 1, name: "Bun planner" },
		{ index: 2, name: "Swift compiler" },
		{ index: 3, name: "Metal device / runtime shader compiler" },
	])("identifies failure of $name", async ({ index, name }) => {
		const runJob = vi.fn<typeof runIndependentBeautyJob>().mockResolvedValue();
		runJob.mockImplementation(async (command) => {
			const current = runJob.mock.calls.findIndex(
				([entry]) => entry === command
			);
			if (current === index) throw new Error("missing or incompatible tool");
		});
		await expect(
			verifyIndependentBeautyEnvironment({
				python: "/python",
				bun: "/bun",
				cwd: "/engine",
				runJob,
			})
		).rejects.toThrow(name);
	});
	it("waits for outstanding probes before failure and installation rollback", async () => {
		let release: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runJob = vi.fn<typeof runIndependentBeautyJob>().mockResolvedValue();
		runJob
			.mockRejectedValueOnce(new Error("import failed"))
			.mockImplementationOnce(() => pending);
		let done = false;
		const verification = verifyIndependentBeautyEnvironment({
			python: "/python",
			bun: "/bun",
			cwd: "/engine",
			runJob,
		}).catch(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		release();
		await verification;
		expect(done).toBe(true);
	});
});
