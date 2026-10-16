/**
 * Copies one project folder's media and settings into another project's
 * folder on disk, so a duplicated project owns its own files instead of
 * pointing back into the source project.
 *
 * @module electron/lib/project-folder-copy
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ProjectFolderCopyResult {
	sourceRoot: string;
	targetRoot: string;
	/** `media/` existed in the source and was copied. */
	copiedMedia: boolean;
	/** `project.qcut` existed in the source and was copied. */
	copiedSettings: boolean;
}

async function exists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

/** Copies `media/` (recursively) and `project.qcut` from one root to another. */
export async function copyProjectFolderContents({
	sourceRoot,
	targetRoot,
}: {
	sourceRoot: string;
	targetRoot: string;
}): Promise<ProjectFolderCopyResult> {
	if (path.resolve(sourceRoot) === path.resolve(targetRoot)) {
		throw new Error("A project cannot be copied onto itself");
	}
	await fs.mkdir(targetRoot, { recursive: true });
	const sourceMedia = path.join(sourceRoot, "media");
	const copiedMedia = await exists(sourceMedia);
	if (copiedMedia) {
		await fs.cp(sourceMedia, path.join(targetRoot, "media"), {
			recursive: true,
			force: true,
		});
	}
	const sourceSettings = path.join(sourceRoot, "project.qcut");
	const copiedSettings = await exists(sourceSettings);
	if (copiedSettings) {
		await fs.copyFile(sourceSettings, path.join(targetRoot, "project.qcut"));
	}
	return { sourceRoot, targetRoot, copiedMedia, copiedSettings };
}
