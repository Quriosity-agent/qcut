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
 * copied from (`metadata.sourceFile`). A file whose size or time no longer
 * matches is read again. An item from before this was recorded is compared
 * by size alone, the one thing known about what it was copied from; if that
 * matches, the file's present size and time are taken as its record.
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
import { getImageDimensions } from "@/stores/media/media-store-helpers";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { ProjectFolderFileInfo } from "@/types/electron.d";

/** The file an item's bytes were copied from, as it was then. */
export interface SourceFileStat {
	size: number;
	/** Milliseconds, as the file system reports it. */
	modifiedAt: number;
}

export interface MediaSourceRefreshResult {
	/** Items with a file in the project folder that were looked at. */
	checked: number;
	/** Items whose file had changed and was read again. */
	refreshed: Array<{ id: string; name: string }>;
	/** Items whose changed file could not be read; they keep their old copy. */
	failed: Array<{ id: string; name: string; error: string }>;
}

/** File systems keep times to different precisions; under this is the same. */
const SAME_TIME_MS = 2;
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
 * must never be read into the other's item. Only when no file has the path
 * as written is case set aside, and then only if a single file answers to
 * it (a file system that ignores case, a path typed in another case).
 */
function scannedFiles(diskFiles: ProjectFolderFileInfo[]): {
	find: (localPath: string) => ProjectFolderFileInfo | undefined;
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
	return {
		find: (localPath) => {
			const path = slashed(localPath);
			const exact = asWritten.get(path);
			if (exact) return exact;
			const candidates = caseSetAside.get(path.toLowerCase()) ?? [];
			return candidates.length === 1 ? candidates[0] : undefined;
		},
	};
}

/** The record on an item, or undefined when it has none that can be used. */
export function readSourceFileStat({
	item,
}: {
	item: Pick<MediaItem, "metadata">;
}): SourceFileStat | undefined {
	const recorded = item.metadata?.sourceFile as
		| Partial<SourceFileStat>
		| undefined;
	if (
		!recorded ||
		typeof recorded.size !== "number" ||
		typeof recorded.modifiedAt !== "number" ||
		!Number.isFinite(recorded.size) ||
		!Number.isFinite(recorded.modifiedAt)
	) {
		return;
	}
	return { size: recorded.size, modifiedAt: recorded.modifiedAt };
}

function sameStat(left: SourceFileStat, right: SourceFileStat): boolean {
	return (
		left.size === right.size &&
		Math.abs(left.modifiedAt - right.modifiedAt) <= SAME_TIME_MS
	);
}

export interface MediaSourcePlan {
	/** The file is not what the item was copied from: read it again. */
	changed: Array<{ item: MediaItem; file: ProjectFolderFileInfo }>;
	/** No record yet and nothing says it changed: record the file as it is. */
	adopt: Array<{ item: MediaItem; file: ProjectFolderFileInfo }>;
	checked: number;
}

/**
 * Sorts the items that have a file in the project folder into those whose
 * file changed since it was copied, and those that only lack a record.
 */
export function planMediaSourceRefresh({
	diskFiles,
	mediaItems,
}: {
	diskFiles: ProjectFolderFileInfo[];
	mediaItems: MediaItem[];
}): MediaSourcePlan {
	const scanned = scannedFiles(diskFiles);
	const plan: MediaSourcePlan = { changed: [], adopt: [], checked: 0 };
	for (const item of mediaItems) {
		// An item without bytes of its own has no copy that could be stale.
		if (item.ephemeral || !item.localPath || !(item.file?.size > 0)) continue;
		const file = scanned.find(item.localPath);
		if (!file) continue;
		plan.checked += 1;
		const recorded = readSourceFileStat({ item });
		if (recorded) {
			if (!sameStat(recorded, file)) plan.changed.push({ item, file });
			continue;
		}
		if (item.file.size === file.size) plan.adopt.push({ item, file });
		else plan.changed.push({ item, file });
	}
	return plan;
}

function withSourceFile({
	item,
	stat,
}: {
	item: MediaItem;
	stat: SourceFileStat;
}): MediaItem["metadata"] {
	return {
		...item.metadata,
		sourceFile: { size: stat.size, modifiedAt: stat.modifiedAt },
	};
}

/**
 * The file's size and time now. The desktop app answers with dates
 * (`lastModified`, `modified`), which is not what its declared type says, so
 * both shapes are read.
 */
async function statFile({
	filePath,
}: {
	filePath: string;
}): Promise<SourceFileStat> {
	const info = (await platform().files.getFileInfo(filePath)) as unknown as {
		size?: unknown;
		modifiedAt?: unknown;
		lastModified?: unknown;
		modified?: unknown;
	} | null;
	if (!info || typeof info.size !== "number") {
		throw new Error("the file is gone");
	}
	const when = info.modifiedAt ?? info.lastModified ?? info.modified;
	const modifiedAt =
		typeof when === "number" ? when : new Date(when as string | Date).getTime();
	if (!Number.isFinite(modifiedAt)) {
		throw new Error("the file's modification time could not be read");
	}
	return { size: info.size, modifiedAt };
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
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; stat: SourceFileStat }> {
	let before: SourceFileStat = { size: file.size, modifiedAt: file.modifiedAt };
	for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
		const buffer = await platform().files.readFile(file.path);
		if (!buffer) throw new Error("the file could not be read");
		const after = await statFile({ filePath: file.path });
		if (buffer.byteLength === after.size && sameStat(before, after)) {
			return { bytes: new Uint8Array(buffer), stat: before };
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

const inFlight = new Map<string, Promise<MediaSourceRefreshResult>>();

/**
 * Reads again every media file of the project that changed in the project
 * folder since the editor copied it. `diskFiles` is a scan of the project's
 * media folder the caller already has; without one the folder is scanned.
 * One run per project at a time: a second call joins the run under way.
 */
export function refreshChangedMediaSources({
	projectId,
	diskFiles,
}: {
	projectId: string;
	diskFiles?: ProjectFolderFileInfo[];
}): Promise<MediaSourceRefreshResult> {
	const running = inFlight.get(projectId);
	if (running) return running;
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
	const files =
		diskFiles ??
		(
			await platform().projectFolder.scan(projectId, "media", {
				recursive: true,
				mediaOnly: true,
			})
		).files;
	// Loaded on use: the stores load this module's callers themselves.
	const { useMediaStore } = await import("@/stores/media/media-store");
	const { useProjectStore } = await import("@/stores/project-store");
	const plan = planMediaSourceRefresh({
		diskFiles: files,
		mediaItems: useMediaStore.getState().mediaItems,
	});
	result.checked = plan.checked;

	/**
	 * The item as the store holds it now, or undefined once it is no longer
	 * this project's item for this file. A media id is made from the file's
	 * name, so another project with a file of that name has an item of the
	 * same id: after a switch of projects, a write by id would land on it.
	 */
	const stillHeld = (planned: MediaItem): MediaItem | undefined => {
		if (useProjectStore.getState().activeProject?.id !== projectId) return;
		const live = useMediaStore
			.getState()
			.mediaItems.find((candidate) => candidate.id === planned.id);
		return live && live.localPath === planned.localPath ? live : undefined;
	};

	for (const { item, file } of plan.adopt) {
		if (!stillHeld(item)) break;
		// Added to what the item holds now, not to what it held when the
		// folder was scanned: another task may have recorded something since.
		useMediaStore.setState((state) => ({
			mediaItems: state.mediaItems.map((candidate) =>
				candidate.id === item.id
					? {
							...candidate,
							metadata: withSourceFile({ item: candidate, stat: file }),
						}
					: candidate
			),
		}));
		const recorded = stillHeld(item);
		if (!recorded) break;
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
		// The project was closed or another one opened: what is left belongs
		// to the next check of this project.
		if (!stillHeld(item)) break;
		let replacementUrl: string | undefined;
		try {
			const { bytes, stat } = await readSettledFile({ file });
			const mimeType =
				item.file.type || getMimeType(file.name, file.type) || "";
			const fresh = new File([bytes], item.name, {
				type: mimeType,
				lastModified: Math.round(stat.modifiedAt),
			});
			const dimensions = await freshDimensions({ item, file: fresh });
			// Reading took a while; the item is looked up again and written to
			// in the same breath, with nothing awaited in between.
			const held = stillHeld(item);
			if (!held) break;
			// What was learned about the old file describes another file now.
			const { alpha: _alpha, ...metadata } =
				withSourceFile({ item: held, stat }) ?? {};
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
			const message = error instanceof Error ? error.message : String(error);
			debugError(`[MediaSourceRefresh] ${item.name}: ${message}`);
			result.failed.push({ id: item.id, name: item.name, error: message });
		}
	}
	if (result.refreshed.length > 0) {
		debugLog(
			`[MediaSourceRefresh] Read ${result.refreshed.length} changed file(s) again:`,
			result.refreshed.map((entry) => entry.name)
		);
	}
	return result;
}
