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
	persistMediaRestrictedMetadata,
	readMediaRestrictedMetadata,
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
	const wantedPath = path.join(mediaDir, newNameWithExt);
	const newPath = exactName
		? wantedPath
		: await getUniqueFilePath(mediaDir, newNameWithExt);
	if (exactName) {
		const taken = await fs
			.access(newPath)
			.then(() => true)
			.catch(() => false);
		if (taken) {
			throw new Error(
				`${newNameWithExt} is already taken in the project's media folder`
			);
		}
	}
	const newMediaId = createMediaId({ fileName: path.basename(newPath) });
	await moveMediaFile({
		projectId,
		from: { id: mediaFile.id, path: mediaFile.path },
		to: { id: newMediaId, path: newPath },
	});
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

/** Moves a media file and its restricted metadata from one id to another. */
async function moveMediaFile({
	projectId,
	from,
	to,
}: {
	projectId: string;
	from: { id: string; path: string };
	to: { id: string; path: string };
}): Promise<void> {
	const metadata = await readMediaRestrictedMetadata({
		mediaId: from.id,
		projectId,
	});
	if (metadata) {
		await persistMediaRestrictedMetadata({
			mediaId: to.id,
			metadata,
			projectId,
		});
	}

	try {
		await fs.rename(from.path, to.path);
	} catch (error) {
		if (metadata) {
			await deleteMediaRestrictedMetadata({
				mediaId: to.id,
				projectId,
			}).catch(() => undefined);
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
	const taken = await fs
		.access(renamed.previous.path)
		.then(() => true)
		.catch(() => false);
	if (taken) {
		throw new Error(
			`${renamed.previous.name} was taken again before the rename could be undone`
		);
	}
	await moveMediaFile({
		projectId,
		from: { id: renamed.id, path: renamed.path },
		to: { id: renamed.previous.id, path: renamed.previous.path },
	});
}
