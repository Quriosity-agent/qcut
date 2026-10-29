/**
 * Copies one project folder's media and settings into another project's
 * folder on disk, so a duplicated project owns its own files instead of
 * pointing back into the source project.
 *
 * @module electron/lib/project-folder-copy
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/**
 * Copies a folder's files into another, replacing files of the same name.
 * On macOS `cp -c` clones them (APFS copy-on-write): a duplicate takes no
 * space until a file changes on one side, and either side can change
 * without the other. Node cannot clone there (its COPYFILE_FICLONE copies
 * in full), so cp does it; cp itself copies in full where it cannot clone.
 * Elsewhere, or if cp fails, fs.cp clones where the file system can.
 */
async function copyFolderFiles({
	source,
	target,
}: {
	source: string;
	target: string;
}): Promise<void> {
	if (process.platform === "darwin") {
		try {
			await execFileAsync("/bin/cp", ["-c", "-f", "-R", `${source}/.`, target]);
			return;
		} catch {
			// The plain copy below replaces whatever cp got through.
		}
	}
	await fs.cp(source, target, {
		recursive: true,
		force: true,
		mode: fs.constants.COPYFILE_FICLONE,
	});
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
		await copyFolderFiles({
			source: sourceMedia,
			target: path.join(targetRoot, "media"),
		});
	}
	const sourceSettings = path.join(sourceRoot, "project.qcut");
	const copiedSettings = await exists(sourceSettings);
	if (copiedSettings) {
		await fs.copyFile(sourceSettings, path.join(targetRoot, "project.qcut"));
	}
	return { sourceRoot, targetRoot, copiedMedia, copiedSettings };
}
