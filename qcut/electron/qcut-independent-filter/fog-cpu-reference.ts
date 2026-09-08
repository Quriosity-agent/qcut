import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { IndependentFilterRequest } from "./contract.js";
import { FOG_COMPARISON_STAGES } from "./comparison-contract.js";
import { resolveFogCpuHost } from "./fog-cpu-bridge.js";

const execFileAsync = promisify(execFile);

export async function renderFogCpuReference({
	request,
	lut,
}: {
	request: IndependentFilterRequest;
	lut: Uint8Array;
}) {
	const host = await resolveFogCpuHost();
	const binarySha256 = createHash("sha256")
		.update(await readFile(host))
		.digest("hex");
	const directory = await mkdtemp(join(tmpdir(), "qcut-fog-comparison-"));
	try {
		const input = join(directory, "input.rgba");
		const atlas = join(directory, "lut.rgba");
		const output = join(directory, "output.rgba");
		const trace = join(directory, "stages");
		await Promise.all([writeFile(input, request.rgba), writeFile(atlas, lut)]);
		await execFileAsync(
			host,
			[
				"--input",
				input,
				"--output",
				output,
				"--width",
				String(request.width),
				"--height",
				String(request.height),
				"--intensity",
				String(request.intensity / 100),
				"--lut",
				atlas,
				"--trace",
				trace,
			],
			{
				timeout: 120_000,
				maxBuffer: 1024 * 1024,
				env: {
					...process.env,
					DYLD_LIBRARY_PATH: "",
					DYLD_INSERT_LIBRARIES: "",
					DYLD_FRAMEWORK_PATH: "",
				},
			}
		);
		const stages = await Promise.all(
			FOG_COMPARISON_STAGES.map(async (name) => ({
				name,
				rgba: new Uint8Array(await readFile(join(trace, `${name}.rgba`))),
			}))
		);
		const rgba = new Uint8Array(await readFile(output));
		const expected = request.width * request.height * 4;
		if (
			rgba.length !== expected ||
			stages.some((stage) => stage.rgba.length !== expected)
		) {
			throw new Error("C++ 对照输出尺寸不一致。");
		}
		if (!Buffer.from(rgba).equals(stages[stages.length - 1].rgba))
			throw new Error("C++ 最终阶段与输出不一致。");
		return { rgba, stages, binarySha256 };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
