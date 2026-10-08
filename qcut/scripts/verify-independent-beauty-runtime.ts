import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { verifyIndependentBeautyRuntime } from "../electron/beauty-lab-runtime-payload";

async function main() {
	const [runtimePath, enginePath, ...extra] = process.argv.slice(2);
	if (!runtimePath || !enginePath || extra.length)
		throw new Error("Usage: <audit> <external runtime> <engine source root>");
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
	console.log(
		JSON.stringify(
			{
				runtimeRoot,
				engineRoot,
				...result,
				milliseconds: performance.now() - start,
				pixelsRendered: false,
				pythonEnvironmentVerified: false,
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
