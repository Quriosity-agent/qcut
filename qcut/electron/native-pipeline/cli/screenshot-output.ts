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

/** Move a captured screenshot to `outputPath`, across volumes if needed. */
export async function moveScreenshot({
	sourcePath,
	outputPath,
}: {
	sourcePath: string;
	outputPath: string;
}): Promise<void> {
	if (path.resolve(sourcePath) === outputPath) return;
	await mkdir(path.dirname(outputPath), { recursive: true });
	await rm(outputPath, { force: true });
	try {
		await rename(sourcePath, outputPath);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? (error as { code?: unknown }).code
				: undefined;
		if (code !== "EXDEV") throw error;
		await copyFile(sourcePath, outputPath);
		await unlink(sourcePath);
	}
}
