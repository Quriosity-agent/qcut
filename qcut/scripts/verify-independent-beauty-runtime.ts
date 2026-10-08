import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { verifyIndependentBeautyRuntime } from "../electron/beauty-lab-runtime-payload";
import { verifyIndependentBeautyEnvironment } from "../electron/beauty-lab-runtime-environment";

async function main() {
	const [runtimePath, enginePath, python, bun, ...extra] =
		process.argv.slice(2);
	if (
		!runtimePath ||
		!enginePath ||
		Boolean(python) !== Boolean(bun) ||
		extra.length
	)
		throw new Error(
			"Usage: <audit> <external runtime> <engine source root> [<Python executable> <Bun executable>]"
		);
	if (python && process.platform !== "darwin")
		throw new Error("Environment audit requires macOS");
	const [runtimeRoot, engineRoot] = await Promise.all([
		realpath(runtimePath),
		realpath(enginePath),
	]);
	const manifest = await readFile(
		path.join(engineRoot, "source-manifest.json")
	);
	const start = performance.now();
	const result = await verifyIndependentBeautyRuntime({
		runtimeRoot,
		sourceManifestSha256: createHash("sha256").update(manifest).digest("hex"),
	});
	const capabilities =
		python && bun
			? await verifyIndependentBeautyEnvironment({
					python: path.resolve(python),
					bun: path.resolve(bun),
					cwd: engineRoot,
				})
			: null;
	console.log(
		JSON.stringify(
			{
				runtimeRoot,
				engineRoot,
				...result,
				milliseconds: performance.now() - start,
				pixelsRendered: false,
				pythonEnvironmentVerified: capabilities !== null,
				capabilities,
			},
			null,
			2
		)
	);
}
void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
