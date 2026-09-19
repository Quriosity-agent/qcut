/**
 * Stage the authored ONNX shot-split runtime scripts for packaging.
 *
 * The research tree stays the source of truth (its unit tests run from
 * there), but the build manifest may only ship QCut-owned resources
 * (scripts/check-filter-provenance.ts, rule no-research-in-build). So the
 * runtime files are copied into electron/resources/local-models/shot at
 * build time, and that staged copy is what `extraResources` packs as
 * Resources/local-models/shot, where onnx-engine.ts looks first.
 */
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const LOCAL_MODEL_SHOT_FILES = [
	"shot_onnx.py",
	"shot_video.py",
	"shot_postprocess.py",
	"onnx_infer.py",
	"requirements-onnx-runtime.txt",
];

const projectRoot = path.resolve(import.meta.dir, "..");
const sourceDir = path.join(projectRoot, "research", "local-model-pytorch");
const outputDir = path.join(
	projectRoot,
	"electron",
	"resources",
	"local-models",
	"shot"
);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const name of LOCAL_MODEL_SHOT_FILES) {
	const target = path.join(outputDir, name);
	await copyFile(path.join(sourceDir, name), target);
	if ((await stat(target)).size === 0) {
		throw new Error(`Staged local model file is empty: ${target}`);
	}
}
console.log(
	`Staged local shot model scripts (${LOCAL_MODEL_SHOT_FILES.length} files): ${outputDir}`
);
