/**
 * Keeps the editor's own copy of a media file the same as the file in the
 * project folder.
 *
 * The editor copies every media file into its own store when it imports it,
 * and the preview and the in-editor export play that copy. The native export
 * and the command line read the file in the project folder. A file written
 * over in that folder under the same name (a shot rendered again by a
 * script) left the two apart: the preview went on showing the old picture,
 * the exported file had the new one, and nothing said so.
 *
 * Each item records the size and modification time of the file it was
 * copied from (`metadata.sourceFile`), and by when the editor held the
 * copy. A file whose size or time no longer matches is read again. An item
 * from before this was recorded is compared by size alone, the one thing
 * known about what it was copied from; if that matches, the file's present
 * size and time are taken as its record.
 *
 * @module lib/project/media-source-refresh
 */

import { platform } from "@qcut/platform-core";
import { debugError, debugLog } from "@/lib/debug/debug-config";
import { forgetMediaAlphaInspection } from "@/lib/media/alpha-playback-proxy";
import {
	createReplacementObjectURL,
	releaseObjectURL,
} from "@/lib/media/blob-manager";
import { getMimeType } from "@/lib/media/bulk-import";
import { storageService } from "@/lib/storage/storage-service";
import { saveTrackedMediaItem } from "@/stores/media/media-persistence-queue";
import { readUnsettledRenames } from "@/stores/media/media-rename-notes";
import { getImageDimensions } from "@/stores/media/media-store-helpers";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { ProjectFolderFileInfo } from "@/types/electron.d";
import {
	readSourceFileStat,
	type SourceFileStat,
	sameSourceFile,
	statSourceFile,
} from "./media-source-stat";

export { readSourceFileStat, type SourceFileStat } from "./media-source-stat";

export interface MediaSourceRefreshResult {
	/** Items with a file in the project folder that were looked at. */
	checked: number;
	/** Items whose file had changed and was read again. */
	refreshed: Array<{ id: string; name: string }>;
	/** Items whose changed file could not be read; they keep their old copy. */
	failed: Array<{ id: string; name: string; error: string }>;
}

/** A file still being written when it is read is read again, this often. */
const READ_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

/** The same path whichever slash it is written with. */
function slashed(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

/**
 * Finds the scanned file an item's path names. The path as written wins: on
 * a file system that tells `A.mp4` from `a.mp4` they are two files, and one
 * must never be read into the other's item. Case is set aside only where
 * the folder's file system sets it aside itself (`ignoresCase`), for a path
 * no file is spelled like, and then only if a single file answers to it.
 */
function scannedFiles(diskFiles: ProjectFolderFileInfo[]): {
	find: (request: {
		localPath: string;
		ignoresCase: boolean;
	}) => ProjectFolderFileInfo | undefined;
	/** No file is spelled like the path; one is, once case is set aside. */
	differsByCase: (localPath: string) => boolean;
} {
	const asWritten = new Map<string, ProjectFolderFileInfo>();
	const caseSetAside = new Map<string, ProjectFolderFileInfo[]>();
	for (const file of diskFiles) {
		if (file.isDirectory) continue;
		const path = slashed(file.path);
		asWritten.set(path, file);
		const folded = path.toLowerCase();
		caseSetAside.set(folded, [...(caseSetAside.get(folded) ?? []), file]);
	}
	const otherwiseSpelled = (path: string): ProjectFolderFileInfo[] =>
		asWritten.has(path) ? [] : (caseSetAside.get(path.toLowerCase()) ?? []);
	return {
		find: ({ localPath, ignoresCase }) => {
			const path = slashed(localPath);
			const exact = asWritten.get(path);
			if (exact || !ignoresCase) return exact;
			const candidates = otherwiseSpelled(path);
			return candidates.length === 1 ? candidates[0] : undefined;
		},
		differsByCase: (localPath) =>
			otherwiseSpelled(slashed(localPath)).length > 0,
	};
}

export interface MediaSourcePlan {
	/** The file is not what the item was copied from: read it again. */
	changed: Array<{ item: MediaItem; file: ProjectFolderFileInfo }>;
	/** No record yet and nothing says it changed: record the file as it is. */
	adopt: Array<{ item: MediaItem; file: ProjectFolderFileInfo }>;
	/**
	 * The file is not what the item was copied from, and the item is one of
	 * a rename that is not settled: left as it is until the rename is.
	 */
	unsettled: Array<{ item: MediaItem; file: ProjectFolderFileInfo }>;
	checked: number;
}

/**
 * Sorts the items that have a file in the project folder into those whose
 * file changed since it was copied, and those that only lack a record.
 * `ignoresCase` says the folder's file system takes `A.mp4` and `a.mp4` for
 * one file (see `folderIgnoresCase`); without it a path names a file only
 * as it is written.
 *
 * `unsettled` are the ids of renames that are not settled yet. Which file
 * such an item plays is what the rename's note settles, and the item's
 * record of the file it was copied from is what that goes by: it tells the
 * renamed file's own item from an item of another file that has taken the
 * name. So neither the record nor the bytes of such an item are touched.
 */
export function planMediaSourceRefresh({
	diskFiles,
	mediaItems,
	ignoresCase = false,
	unsettled,
}: {
	diskFiles: ProjectFolderFileInfo[];
	mediaItems: MediaItem[];
	ignoresCase?: boolean;
	unsettled?: ReadonlySet<string>;
}): MediaSourcePlan {
	const scanned = scannedFiles(diskFiles);
	const plan: MediaSourcePlan = {
		changed: [],
		adopt: [],
		unsettled: [],
		checked: 0,
	};
	for (const item of mediaItems) {
		// An item without bytes of its own has no copy that could be stale.
		if (item.ephemeral || !item.localPath || !(item.file?.size > 0)) continue;
		const file = scanned.find({ localPath: item.localPath, ignoresCase });
		if (!file) continue;
		plan.checked += 1;
		const recorded = readSourceFileStat({ item });
		const changed = recorded
			? !sameSourceFile(recorded, file)
			: item.file.size !== file.size;
		if (unsettled?.has(item.id)) {
			if (changed) plan.unsettled.push({ item, file });
		} else if (changed) {
			plan.changed.push({ item, file });
		} else if (!recorded) {
			plan.adopt.push({ item, file });
		}
	}
	return plan;
}

/** The notes of renames could not be read, so nothing was checked. */
class RenameNotesUnreadError extends Error {
	constructor(cause: unknown) {
		super(
			`The notes of media renames could not be read (${cause instanceof Error ? cause.message : String(cause)}), so the media files were not checked: an item of a rename that is not settled must not be read from another file`,
			{ cause }
		);
		this.name = "RenameNotesUnreadError";
	}
}

/**
 * The ids of the project's renames that are not settled yet.
 *
 * It fails when the notes cannot be read, and the check with it. Going on
 * as if there were none would read whatever file has an item's name into
 * the item, and write that file into its record: for an item of a rename
 * that is not settled, another file's. The rename's note would later take
 * the item for that other file's own, by its record, and be dropped.
 */
async function idsOfUnsettledRenames(projectId: string): Promise<Set<string>> {
	let notes: Awaited<ReturnType<typeof readUnsettledRenames>>;
	try {
		notes = await readUnsettledRenames(projectId);
	} catch (error) {
		debugError("[MediaSourceRefresh] Could not read the rename notes", error);
		throw new RenameNotesUnreadError(error);
	}
	return new Set(notes.flatMap((note) => [note.oldId, note.newId]));
}

/**
 * The item's metadata with its record of the file it was copied from.
 * `heldSince` is the moment by which the editor held these bytes: when they
 * had been read, or, where only the record is new, now.
 */
function withSourceFile({
	item,
	stat,
	heldSince,
}: {
	item: MediaItem;
	stat: Pick<SourceFileStat, "size" | "modifiedAt">;
	heldSince: number;
}): MediaItem["metadata"] {
	return {
		...item.metadata,
		sourceFile: { size: stat.size, modifiedAt: stat.modifiedAt, heldSince },
	};
}

/**
 * Whether the project folder's file system sets case aside. It is asked, not
 * guessed from the platform: a Mac volume can tell case apart, and a Linux
 * folder can ignore it.
 *
 * It only matters for an item whose path no file in the folder is spelled
 * like, while one is once case is set aside. Such a path is looked up as it
 * is written: it can only answer where case is ignored, and that file is
 * then the item's. Where case counts, the other spelling is another file,
 * and reading it would put that file's picture into this item.
 *
 * One path that answers settles it. One that does not settles nothing: its
 * file may have gone since the folder was scanned, so the next is asked.
 */
async function folderIgnoresCase({
	diskFiles,
	mediaItems,
}: {
	diskFiles: ProjectFolderFileInfo[];
	mediaItems: MediaItem[];
}): Promise<boolean> {
	const scanned = scannedFiles(diskFiles);
	for (const item of mediaItems) {
		if (!item.localPath || !scanned.differsByCase(item.localPath)) continue;
		const answers = await statSourceFile({ filePath: item.localPath }).then(
			() => true,
			() => false
		);
		if (answers) return true;
	}
	return false;
}

/**
 * Reads the file and says what it was when read. A file whose size or time
 * moved while it was being read (a script still writing it) is read again;
 * one that never settles is an error, so its record is not set and the next
 * check tries again.
 */
async function readSettledFile({
	file,
}: {
	file: ProjectFolderFileInfo;
}): Promise<{
	bytes: Uint8Array<ArrayBuffer>;
	stat: SourceFileStat;
	/** The moment the bytes had been read. */
	readAt: number;
}> {
	let before: SourceFileStat = { size: file.size, modifiedAt: file.modifiedAt };
	for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
		const buffer = await platform().files.readFile(file.path);
		if (!buffer) throw new Error("the file could not be read");
		const readAt = Date.now();
		const after = await statSourceFile({ filePath: file.path });
		if (buffer.byteLength === after.size && sameSourceFile(before, after)) {
			return { bytes: new Uint8Array(buffer), stat: before, readAt };
		}
		before = after;
		if (attempt < READ_ATTEMPTS) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		}
	}
	throw new Error("the file kept changing while it was read");
}

/**
 * A still's size is read here; a video's comes with its new thumbnail, which
 * the store makes when the file changes.
 */
async function freshDimensions({
	item,
	file,
}: {
	item: MediaItem;
	file: File;
}): Promise<{ width?: number; height?: number }> {
	if (item.type === "audio") return {};
	if (item.type !== "image") return { width: undefined, height: undefined };
	try {
		return await getImageDimensions(file);
	} catch {
		return { width: undefined, height: undefined };
	}
}

/** The project was left while its media files were being checked. */
class ProjectLeftError extends Error {
	constructor() {
		super(
			"The project was closed or another one opened while its media files were being checked; the check is not complete"
		);
		this.name = "ProjectLeftError";
	}
}

/**
 * A changed file that was not read into its item, because the item went
 * away or was given other bytes while this check was at it. It is listed
 * with the failures: its copy was not brought up to date here.
 */
function passedOver(item: MediaItem): MediaSourceRefreshResult["failed"][0] {
	return {
		id: item.id,
		name: item.name,
		error:
			"the item was removed or replaced while its file was read; check again",
	};
}

const inFlight = new Map<string, Promise<MediaSourceRefreshResult>>();
/** The one run owed to those who asked while another was under way. */
const followUps = new Map<string, Promise<MediaSourceRefreshResult>>();

/**
 * Reads again every media file of the project that changed in the project
 * folder since the editor copied it. `diskFiles` is a scan of the project's
 * media folder the caller already has; without one the folder is scanned.
 * One run per project at a time. A call that comes while one is under way
 * gets the run that follows it, shared with the others that came meanwhile.
 *
 * It fails when the project is closed, or another one opened, before every
 * file was looked at: the files are then not to be taken for checked. It
 * fails as well, before anything is changed, when the notes of renames
 * cannot be read (`idsOfUnsettledRenames`).
 */
export function refreshChangedMediaSources({
	projectId,
	diskFiles,
}: {
	projectId: string;
	diskFiles?: ProjectFolderFileInfo[];
}): Promise<MediaSourceRefreshResult> {
	const running = inFlight.get(projectId);
	if (running) {
		// The run under way listed the folder when it started: a file written
		// since is not in its answer. One more run follows it, with a scan of
		// its own, for everyone who asked meanwhile.
		let queued = followUps.get(projectId);
		if (!queued) {
			queued = running
				.then(
					() => undefined,
					() => undefined
				)
				.then(() => {
					followUps.delete(projectId);
					return refreshChangedMediaSources({ projectId });
				});
			followUps.set(projectId, queued);
		}
		return queued;
	}
	const run = refreshOnce({ projectId, diskFiles }).finally(() => {
		inFlight.delete(projectId);
	});
	inFlight.set(projectId, run);
	return run;
}

async function refreshOnce({
	projectId,
	diskFiles,
}: {
	projectId: string;
	diskFiles?: ProjectFolderFileInfo[];
}): Promise<MediaSourceRefreshResult> {
	const result: MediaSourceRefreshResult = {
		checked: 0,
		refreshed: [],
		failed: [],
	};
	// Loaded on use: the stores load this module's callers themselves.
	const { useMediaStore } = await import("@/stores/media/media-store");
	const { useProjectStore } = await import("@/stores/project-store");
	/**
	 * Ends the check once the project is closed or another one is open. A
	 * media id is made from the file's name, so another project with a file
	 * of that name has an item of the same id: a write by id would land on
	 * it. What was not looked at yet is said to be so, by failing: whoever
	 * asked must not take the files for checked.
	 *
	 * It is asked after every wait, also where nothing is written: the plan
	 * is made from the items the store holds, and with another project's
	 * items it would be an empty plan that reads as "nothing had changed".
	 */
	const stayInProject = () => {
		if (useProjectStore.getState().activeProject?.id !== projectId) {
			throw new ProjectLeftError();
		}
	};
	stayInProject();
	const files =
		diskFiles ??
		(
			await platform().projectFolder.scan(projectId, "media", {
				recursive: true,
				mediaOnly: true,
			})
		).files;
	stayInProject();
	const ignoresCase = await folderIgnoresCase({
		diskFiles: files,
		mediaItems: useMediaStore.getState().mediaItems,
	});
	stayInProject();
	const unsettled = await idsOfUnsettledRenames(projectId);
	stayInProject();
	const plan = planMediaSourceRefresh({
		diskFiles: files,
		mediaItems: useMediaStore.getState().mediaItems,
		ignoresCase,
		unsettled,
	});
	result.checked = plan.checked;
	for (const { item } of plan.unsettled) {
		result.failed.push({
			id: item.id,
			name: item.name,
			error:
				"its file was renamed and the rename is not settled yet; it is read again once it is",
		});
	}
	/**
	 * The item as the store holds it now, or undefined once it is gone or
	 * plays another file. Only that item is passed over: the others are
	 * still looked at.
	 */
	const stillHeld = (planned: MediaItem): MediaItem | undefined => {
		const live = useMediaStore
			.getState()
			.mediaItems.find((candidate) => candidate.id === planned.id);
		return live && live.localPath === planned.localPath ? live : undefined;
	};

	for (const { item, file } of plan.adopt) {
		stayInProject();
		if (!stillHeld(item)) continue;
		const adoptedAt = Date.now();
		// Added to what the item holds now, not to what it held when the
		// folder was scanned: another task may have recorded something since.
		useMediaStore.setState((state) => ({
			mediaItems: state.mediaItems.map((candidate) =>
				candidate.id === item.id
					? {
							...candidate,
							// Its bytes are older than this moment, whenever they
							// were read.
							metadata: withSourceFile({
								item: candidate,
								stat: file,
								heldSince: adoptedAt,
							}),
						}
					: candidate
			),
		}));
		const recorded = stillHeld(item);
		if (!recorded) continue;
		try {
			// The record only: the bytes are what they were.
			await saveTrackedMediaItem({
				projectId,
				id: item.id,
				save: () => storageService.saveMediaItemRecord(projectId, recorded),
			});
		} catch (error) {
			// Not recorded: the next check compares by size again.
			debugError("[MediaSourceRefresh] Could not record a file", error);
		}
	}

	for (const { item, file } of plan.changed) {
		stayInProject();
		const started = stillHeld(item);
		if (!started) {
			result.failed.push(passedOver(item));
			continue;
		}
		let replacementUrl: string | undefined;
		try {
			const { bytes, stat, readAt } = await readSettledFile({ file });
			const mimeType =
				item.file.type || getMimeType(file.name, file.type) || "";
			const fresh = new File([bytes], item.name, {
				type: mimeType,
				lastModified: Math.round(stat.modifiedAt),
			});
			const dimensions = await freshDimensions({ item, file: fresh });
			// Reading took a while; the item is looked up again and written to
			// in the same breath, with nothing awaited in between.
			stayInProject();
			const held = stillHeld(item);
			// Gone, or given other bytes meanwhile (relinked, replaced): what
			// it holds now is newer than what was read here, and must not be
			// written over with it.
			if (!held || held.file !== started.file) {
				result.failed.push(passedOver(item));
				continue;
			}
			// What was learned about the old file describes another file now.
			const { alpha: _alpha, ...metadata } =
				withSourceFile({ item: held, stat, heldSince: readAt }) ?? {};
			if (item.localPath) {
				forgetMediaAlphaInspection({ localPath: item.localPath });
			}
			// Its own URL: one looked up by name and size would be the old
			// file's whenever the new file is as long as the old one.
			replacementUrl = createReplacementObjectURL(
				fresh,
				"media-source-refresh"
			);
			const updated = await useMediaStore
				.getState()
				.updateMediaItem(projectId, item.id, {
					file: fresh,
					url: replacementUrl,
					metadata,
					thumbnailUrl: undefined,
					thumbnailStatus: item.type === "video" ? "pending" : undefined,
					// Read again from the new file by the store.
					duration: undefined,
					...dimensions,
				});
			if (!updated) throw new Error("the new copy could not be stored");
			// The item held the old URL; nothing of the old file is kept for it.
			if (held.url?.startsWith("blob:") && held.url !== replacementUrl) {
				releaseObjectURL(held.url, "media-source-refresh:superseded");
			}
			result.refreshed.push({ id: item.id, name: item.name });
		} catch (error) {
			if (replacementUrl) {
				releaseObjectURL(replacementUrl, "media-source-refresh:failed");
			}
			// Not one file's failure: the check as a whole stops here.
			if (error instanceof ProjectLeftError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			debugError(`[MediaSourceRefresh] ${item.name}: ${message}`);
			result.failed.push({ id: item.id, name: item.name, error: message });
		}
	}
	// The last wait may have been the one the project was left in.
	stayInProject();
	if (result.refreshed.length > 0) {
		debugLog(
			`[MediaSourceRefresh] Read ${result.refreshed.length} changed file(s) again:`,
			result.refreshed.map((entry) => entry.name)
		);
	}
	return result;
}
