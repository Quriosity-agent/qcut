/**
 * `editor:screenshot:capture --output <path>`: put the screenshot where the
 * caller asked.
 *
 * QCut always saves captures into its recordings folder, and `--filename`
 * only names the file inside it. With `--output` the CLI moves the saved PNG
 * to the requested path afterwards, the way pointer-sequence recordings are
 * moved, so the editor's own save location stays unchanged.
 *
 * @module electron/native-pipeline/cli/screenshot-output
 */

import { copyFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

/** `requested` as an absolute .png path; other extensions are refused. */
export function resolveScreenshotOutputPath({
	requested,
}: {
	requested: string;
}): string {
	const extension = path.extname(requested).toLowerCase();
	if (extension && extension !== ".png") {
		throw new Error("Screenshots are PNG files; give --output a .png path");
	}
	return path.resolve(extension ? requested : `${requested}.png`);
}

/**
 * Move a captured screenshot to `outputPath`, across volumes if needed. The
 * capture is staged next to the destination first and renamed over it last,
 * so a failed move never costs an existing file at that path.
 */
export async function moveScreenshot({
	sourcePath,
	outputPath,
}: {
	sourcePath: string;
	outputPath: string;
}): Promise<void> {
	if (path.resolve(sourcePath) === outputPath) return;
	await mkdir(path.dirname(outputPath), { recursive: true });
	const stagedPath = path.join(
		path.dirname(outputPath),
		`.${path.basename(outputPath)}.${process.pid}.${Date.now()}.partial`
	);
	let copiedAcrossVolumes = false;
	try {
		try {
			await rename(sourcePath, stagedPath);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? (error as { code?: unknown }).code
					: undefined;
			if (code !== "EXDEV") throw error;
			await copyFile(sourcePath, stagedPath);
			copiedAcrossVolumes = true;
		}
		// rename replaces an existing destination in one step.
		await rename(stagedPath, outputPath);
	} catch (error) {
		await rm(stagedPath, { force: true });
		throw error;
	}
	// The original goes only once its copy is in place.
	if (copiedAcrossVolumes) await unlink(sourcePath);
}
