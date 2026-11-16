/**
 * Renaming a media file in a project folder. Its id follows the file name,
 * so a rename gives it a new id; the HTTP route then has the editor re-key
 * its item and repoint the clips, and undoes the rename when it cannot.
 *
 * @module electron/claude/handlers/claude-media-rename
 */
import { createReadStream } from "fs";
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

/** One file, told from any other that later has its path. */
interface FileIdentity {
	dev: bigint;
	ino: bigint;
}

/** A copy is read and written this much at a time. */
const COPY_CHUNK_BYTES = 4 * 1024 * 1024;

/** Whether the file at the path is the one `identity` names. */
async function isStill({
	filePath,
	identity,
}: {
	filePath: string;
	identity: FileIdentity;
}): Promise<boolean> {
	try {
		const now = await fs.lstat(filePath, { bigint: true });
		return now.dev === identity.dev && now.ino === identity.ino;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

/**
 * Gives up a name this move had taken: removes the file under it, if that
 * still is the one the move put there (`made`). Another file that has the
 * name by now is not this move's to remove. When the move's own file cannot
 * be removed, the file is under both names (`MediaMoveIncompleteError`).
 */
async function giveUpName({
	to,
	made,
	cause,
}: {
	to: string;
	/** Not known when the file had only just been made: it is that one. */
	made: FileIdentity | undefined;
	cause: unknown;
}): Promise<void> {
	try {
		if (made && !(await isStill({ filePath: to, identity: made }))) return;
		await fs.unlink(to);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw new MediaMoveIncompleteError(to, { cause });
	}
}

/**
 * Copies a file to a name nothing has, for a volume without hard links.
 *
 * The new file is made here, by an open that fails when something has the
 * name, and is written through that one handle: from then on it is known by
 * its identity. A copy by path does not say, when it fails, whether the
 * file under the name is the half it wrote or another file that got there
 * first, and it leaves that half behind when it cannot remove it. Here the
 * half is this move's, known as such, and given up like any name it took.
 */
async function copyToFreeName({
	from,
	to,
	source,
}: {
	from: string;
	to: string;
	source: { mode: bigint; atime: Date; mtime: Date };
}): Promise<FileIdentity> {
	const handle = await fs.open(to, "wx", Number(source.mode) & 0o777);
	let made: FileIdentity | undefined;
	try {
		const { dev, ino } = await handle.stat({ bigint: true });
		made = { dev, ino };
		const chunks = createReadStream(from, { highWaterMark: COPY_CHUNK_BYTES });
		// Each is written whole, where the last one ended.
		for await (const chunk of chunks) await handle.writeFile(chunk);
		// A copy is a new file: it is given the times the old one had.
		await handle.utimes(source.atime, source.mtime);
		await handle.close();
		return made;
	} catch (error) {
		await handle.close().catch(() => undefined);
		await giveUpName({ to, made, cause: error });
		throw error;
	}
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
 * - a copy into a file made where nothing was, on a volume without hard
 *   links (exFAT, some network shares). It takes as long as the file is
 *   large, and is the one way left there that cannot write over a file.
 *
 * The file the move put under the new name is known by its identity from
 * then on. The old name is given up only while the new one still is that
 * file. Whatever fails once the new name is taken, that name is given up
 * again, so a failed move leaves the file where it was; another file that
 * has the name by then is left alone. If the move's own file cannot be
 * removed, the file is under both names (`MediaMoveIncompleteError`).
 *
 * What this cannot do. Taking the name is one step, so the move never
 * writes over a file. Giving a name up is two steps: a look at which file
 * has it, then its removal. Nothing available here makes them one: a
 * rename that refuses a taken name (`renameat2`, `renamex_np`), or a
 * removal of a given file and not of a given name, would take a native
 * addon. Should another program rename a file of its own over the new name
 * between the two, a move that is failing removes that file with the name
 * it gives up, and a move that is finishing gives up the old name with the
 * moved file already replaced, as it would have been a moment later.
 */
export async function moveWithoutOverwriting({
	from,
	to,
}: {
	from: string;
	to: string;
}): Promise<void> {
	const source = await fs.lstat(from, { bigint: true });
	const taken = (error: unknown) =>
		errorCode(error) === "EEXIST" ? new MediaNameTakenError(to) : error;
	let made: FileIdentity;
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
		try {
			const { dev, ino } = await fs.lstat(to, { bigint: true });
			made = { dev, ino };
		} catch (error) {
			await giveUpName({ to, made: undefined, cause: error });
			throw error;
		}
	} else {
		try {
			await fs.link(from, to);
			// The same file under either name.
			made = { dev: source.dev, ino: source.ino };
		} catch (error) {
			const code = errorCode(error);
			if (code === "EEXIST" || code === "ENOENT") throw taken(error);
			made = await copyToFreeName({ from, to, source }).catch(
				(copyError: unknown) => {
					throw taken(copyError);
				}
			);
		}
	}
	try {
		// Replaced by another file meanwhile, the new name is that file's:
		// with the old name given up too, this one would be under neither.
		if (!(await isStill({ filePath: to, identity: made }))) {
			throw new MediaNameTakenError(to);
		}
		await fs.unlink(from);
	} catch (error) {
		// Under one name again, the old one: nothing was moved.
		await giveUpName({ to, made, cause: error });
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
 *
 * `beforeMove` is told where the file is about to go, before it is moved:
 * a caller that has others follow the rename records it there, and a rename
 * it cannot record is not made (when `beforeMove` fails, the file stays
 * where it is). `notMoved` is told when the file did not get there after
 * all.
 */
export async function renameMediaFileOnDisk({
	projectId,
	mediaId,
	newName,
	exactName = false,
	beforeMove,
	notMoved,
}: {
	projectId: string;
	mediaId: string;
	newName: string;
	exactName?: boolean;
	beforeMove?: (planned: RenamedMediaFile) => Promise<void>;
	notMoved?: (planned: RenamedMediaFile) => Promise<void>;
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
		const planned: RenamedMediaFile = {
			previous,
			id: createMediaId({ fileName: path.basename(newPath) }),
			name: path.basename(newPath),
			path: newPath,
		};
		await beforeMove?.(planned);
		try {
			await moveMediaFile({
				projectId,
				from: { id: mediaFile.id, path: mediaFile.path },
				to: { id: planned.id, path: newPath },
			});
		} catch (error) {
			// Under both names, the plan still says where a part of it is. And
			// what the caller cannot take back of its record does not hide why
			// the file did not move.
			if (!(error instanceof MediaMoveIncompleteError)) {
				await notMoved?.(planned).catch(() => undefined);
			}
			if (!(error instanceof MediaNameTakenError)) throw error;
			// A name seen free can be taken by the time the file gets there:
			// the next free one is looked for, unless this very name was asked.
			if (exactName) break;
			continue;
		}
		claudeLog.info(
			HANDLER_NAME,
			`Successfully renamed: ${mediaFile.name} -> ${planned.name}`
		);
		return planned;
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
				mediaFilePath: to.path,
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
