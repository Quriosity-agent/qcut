/**
 * Renaming a media file in a project folder. Its id follows the file name,
 * so a rename gives it a new id; the HTTP route then has the editor re-key
 * its item and repoint the clips, and undoes the rename when it cannot.
 *
 * @module electron/claude/handlers/claude-media-rename
 */
import * as fs from "fs/promises";
import * as path from "path";
import { getMediaPath, sanitizeFilename } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";
import { listMediaFiles } from "./claude-media-handler.js";
import { createMediaId, getUniqueFilePath } from "./claude-media-names.js";
import {
	deleteMediaRestrictedMetadata,
	RestrictedMetadataTakenError,
	readMediaRestrictedMetadata,
	type StagedRestrictedMetadata,
	stageMediaRestrictedMetadata,
} from "./claude-media-restricted-metadata.js";

const HANDLER_NAME = "Media";

/** Where a renamed media file was, and where it is now. */
export interface RenamedMediaFile {
	previous: { id: string; name: string; path: string };
	id: string;
	name: string;
	path: string;
}

/** The media item a rename or lookup named is not in the project. */
export class MediaNotFoundError extends Error {
	constructor(mediaId: string) {
		super(`Media not found: ${mediaId}`);
		this.name = "MediaNotFoundError";
	}
}

/** Something already has the name a file was to be moved to. */
export class MediaNameTakenError extends Error {
	constructor(filePath: string) {
		super(`${path.basename(filePath)} is already taken`);
		this.name = "MediaNameTakenError";
	}
}

/**
 * A move failed after the file had its new name, and that name could not be
 * given up again: the file is under both.
 */
export class MediaMoveIncompleteError extends Error {
	constructor(filePath: string, options: { cause: unknown }) {
		super(
			`The move failed and ${path.basename(filePath)} could not be removed again: ${options.cause instanceof Error ? options.cause.message : String(options.cause)}`,
			options
		);
		this.name = "MediaMoveIncompleteError";
	}
}

/**
 * How often a rename looks for another free name when the one it picked is
 * taken before the file gets there.
 */
const FREE_NAME_ATTEMPTS = 5;

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return;
	}
	const { code } = error as { code?: unknown };
	return typeof code === "string" ? code : undefined;
}

async function isTaken(filePath: string): Promise<boolean> {
	return fs.access(filePath).then(
		() => true,
		() => false
	);
}

/**
 * Moves a file to a name nothing has, and never onto another file.
 *
 * `fs.rename` replaces whatever is at the destination, also a file that was
 * created after the name was seen free. So the new name is taken by a call
 * that fails when something has it, and the old name is given up after that:
 *
 * - a hard link, for a file: made only when the name is free, and the file
 *   is the same one under either name;
 * - a symbolic link, made again under the new name: a hard link would
 *   replace the link by the file it points to;
 * - a copy that refuses an existing name, on a volume without hard links
 *   (exFAT, some network shares). It takes as long as the file is large,
 *   and is the one way left there that cannot write over a file.
 *
 * Whatever fails once the new name is taken, that name is given up again,
 * so a failed move leaves the file where it was. If even that fails, the
 * file is under both names (`MediaMoveIncompleteError`).
 */
export async function moveWithoutOverwriting({
	from,
	to,
}: {
	from: string;
	to: string;
}): Promise<void> {
	const source = await fs.lstat(from);
	const taken = (error: unknown) =>
		errorCode(error) === "EEXIST" ? new MediaNameTakenError(to) : error;
	let copied = false;
	if (source.isSymbolicLink()) {
		const target = await fs.readlink(from);
		// A relative link is kept pointing at the same file from its new place.
		const pointsTo =
			path.isAbsolute(target) || path.dirname(from) === path.dirname(to)
				? target
				: path.relative(
						path.dirname(to),
						path.resolve(path.dirname(from), target)
					);
		await fs.symlink(pointsTo, to, "file").catch((error: unknown) => {
			throw taken(error);
		});
	} else {
		try {
			await fs.link(from, to);
		} catch (error) {
			const code = errorCode(error);
			if (code === "EEXIST" || code === "ENOENT") throw taken(error);
			await fs
				.copyFile(from, to, fs.constants.COPYFILE_EXCL)
				.catch((copyError: unknown) => {
					throw taken(copyError);
				});
			copied = true;
		}
	}
	try {
		// A copy is a new file: it is given the times the old one had.
		if (copied) await fs.utimes(to, source.atime, source.mtime);
		await fs.unlink(from);
	} catch (error) {
		// Under one name again, the old one: nothing was moved.
		await fs.unlink(to).catch((cleanupError: unknown) => {
			if (errorCode(cleanupError) === "ENOENT") return;
			throw new MediaMoveIncompleteError(to, { cause: error });
		});
		throw error;
	}
}

/**
 * Renames a media file in the project folder and moves its restricted
 * metadata with it. A media id follows its file name, so the id changes
 * too, and whatever used the old one (the editor's item, its clips) has to
 * be pointed at the new one by the caller.
 *
 * A taken name gets a numeric suffix (`name_1.mp4`), unless `exactName` is
 * set: then a taken name is refused, so a rename can be undone, or a file
 * given back the name it had, without landing next to it. Renaming a file
 * to its own name changes nothing.
 */
export async function renameMediaFileOnDisk({
	projectId,
	mediaId,
	newName,
	exactName = false,
}: {
	projectId: string;
	mediaId: string;
	newName: string;
	exactName?: boolean;
}): Promise<RenamedMediaFile> {
	const sanitizedName = sanitizeFilename(newName);
	if (!sanitizedName) {
		throw new Error(`Invalid new file name: ${JSON.stringify(newName)}`);
	}
	const allMedia = await listMediaFiles(projectId);
	const mediaFile = allMedia.find((m) => m.id === mediaId);
	if (!mediaFile) throw new MediaNotFoundError(mediaId);

	const previous = {
		id: mediaFile.id,
		name: mediaFile.name,
		path: mediaFile.path,
	};
	const originalExt = path.extname(mediaFile.name);
	const newNameWithExt = sanitizedName.includes(".")
		? sanitizedName
		: sanitizedName + originalExt;
	if (newNameWithExt === mediaFile.name) {
		return { previous, ...previous };
	}

	const mediaDir = getMediaPath(projectId);
	for (let attempt = 1; attempt <= FREE_NAME_ATTEMPTS; attempt += 1) {
		const newPath = exactName
			? path.join(mediaDir, newNameWithExt)
			: await getUniqueFilePath(mediaDir, newNameWithExt);
		const newMediaId = createMediaId({ fileName: path.basename(newPath) });
		try {
			await moveMediaFile({
				projectId,
				from: { id: mediaFile.id, path: mediaFile.path },
				to: { id: newMediaId, path: newPath },
			});
		} catch (error) {
			if (!(error instanceof MediaNameTakenError)) throw error;
			// A name seen free can be taken by the time the file gets there:
			// the next free one is looked for, unless this very name was asked.
			if (exactName) break;
			continue;
		}
		claudeLog.info(
			HANDLER_NAME,
			`Successfully renamed: ${mediaFile.name} -> ${path.basename(newPath)}`
		);
		return {
			previous,
			id: newMediaId,
			name: path.basename(newPath),
			path: newPath,
		};
	}
	throw new Error(
		`${newNameWithExt} is already taken in the project's media folder`
	);
}

/**
 * Moves a media file and its restricted metadata from one id to another,
 * never onto a file that is there already (`MediaNameTakenError`).
 *
 * The metadata is in place under the new id before the file gets there, so
 * a restricted file is at no moment in the folder without it. That id can be
 * another file's by then, one that took the name meanwhile: its metadata is
 * neither written over nor removed (see `stageMediaRestrictedMetadata`).
 */
async function moveMediaFile({
	projectId,
	from,
	to,
}: {
	projectId: string;
	from: { id: string; path: string };
	to: { id: string; path: string };
}): Promise<void> {
	// Before anything is written for the new id: a file there owns that id.
	if (await isTaken(to.path)) throw new MediaNameTakenError(to.path);
	const metadata = await readMediaRestrictedMetadata({
		mediaId: from.id,
		projectId,
	});
	let staged: StagedRestrictedMetadata | undefined;
	if (metadata) {
		try {
			staged = await stageMediaRestrictedMetadata({
				mediaId: to.id,
				metadata,
				projectId,
				mediaFileExists: () => isTaken(to.path),
			});
		} catch (error) {
			if (!(error instanceof RestrictedMetadataTakenError)) throw error;
			throw new MediaNameTakenError(to.path);
		}
	}

	try {
		// The name may have been taken while the metadata was written.
		await moveWithoutOverwriting({ from: from.path, to: to.path });
	} catch (error) {
		// A file left under the new name keeps the metadata staged for it:
		// without it, a restricted file would be listed as an ordinary one.
		if (!(error instanceof MediaMoveIncompleteError)) {
			await staged?.discard().catch(() => undefined);
		}
		throw error;
	}
	if (metadata) {
		await deleteMediaRestrictedMetadata({
			mediaId: from.id,
			projectId,
		}).catch((error) => {
			claudeLog.warn(
				HANDLER_NAME,
				`Renamed media but could not remove its old restricted metadata: ${String(error)}`
			);
		});
	}
}

/**
 * Puts a renamed file back where it was, under its old name and id: what
 * a rename the editor could not follow leaves behind is undone this way.
 */
export async function undoMediaRename({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<void> {
	if (renamed.path === renamed.previous.path) return;
	try {
		await moveMediaFile({
			projectId,
			from: { id: renamed.id, path: renamed.path },
			to: { id: renamed.previous.id, path: renamed.previous.path },
		});
	} catch (error) {
		if (!(error instanceof MediaNameTakenError)) throw error;
		throw new Error(
			`${renamed.previous.name} was taken again before the rename could be undone`
		);
	}
}
