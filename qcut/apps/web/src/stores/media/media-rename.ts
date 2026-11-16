import { debugWarn } from "@/lib/debug/debug-config";
import { forgetMediaAlphaInspection } from "@/lib/media/alpha-playback-proxy";
import { storageService } from "@/lib/storage/storage-service";
import { useProjectStore } from "../project-store";
import { useStickersOverlayStore } from "../stickers-overlay-store";
import { repointMediaReferences } from "../timeline/media-references";
import { useTimelineStore } from "../timeline/timeline-store";
import {
	deleteTrackedMediaItem,
	saveTrackedMediaItem,
} from "./media-persistence-queue";
import { useMediaStore } from "./media-store";
import type { MediaItem } from "./media-store-types";

export interface ProjectMediaRename {
	projectId: string;
	/** The id the item and its clips have now. */
	fromId: string;
	/** The id the renamed file has in the project folder. */
	toId: string;
	name: string;
	localPath: string;
	/**
	 * When the asker stops waiting (epoch milliseconds). Past it the asker
	 * has put the file back under its old name, so nothing may be left
	 * pointing at the new one.
	 */
	deadlineAt?: number;
}

export interface ProjectMediaRenameResult {
	/** The editor held the item and re-keyed it. */
	mediaRenamed: boolean;
	/** Clips now pointing at the new id, over every scene. */
	clipsUpdated: number;
	stickersUpdated: number;
}

/** What puts one finished step back, should a later step fail. */
type Undo = () => Promise<void> | void;

/**
 * Follows a media file that was renamed in the project folder.
 *
 * A media id follows its file name, so the renamed file is a new id to the
 * project folder. The editor's item is stored again under that id with the
 * new name and path, every clip that played the old id is pointed at the new
 * one (in the open scene and in the stored ones), and so are the stickers.
 * Left undone, the clips kept an id nothing answered to: the preview still
 * played them from the editor's own copy, and the native export left them
 * out.
 *
 * It is all or nothing. The asker puts the file back under its old name when
 * this fails, so a failure part-way (a scene that cannot be saved, the
 * asker's deadline passing while a large file is copied) takes back every
 * step already made, in reverse: the project is then as it was, pointing at
 * the old id, which the file has again. Only removing the old stored entry,
 * the last step, is allowed to fail: the rename stands and a stale entry is
 * left.
 */
export async function renameProjectMedia({
	projectId,
	fromId,
	toId,
	name,
	localPath,
	deadlineAt,
}: ProjectMediaRename): Promise<ProjectMediaRenameResult> {
	if (fromId === toId) {
		return { mediaRenamed: false, clipsUpdated: 0, stickersUpdated: 0 };
	}
	const { mediaItems } = useMediaStore.getState();
	const previous = mediaItems.find((item) => item.id === fromId);
	if (mediaItems.some((item) => item.id === toId)) {
		throw new Error(
			`The project already has a media item with the id of ${name} (${toId})`
		);
	}

	const undo: Undo[] = [];
	const inTime = () => {
		if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
			throw new Error(
				"The rename took longer than the request waits for; nothing was changed"
			);
		}
	};

	try {
		if (previous) {
			const renamed: MediaItem = {
				...previous,
				id: toId,
				name,
				localPath,
				isLocalFile: true,
				file: new File([previous.file], name, {
					type: previous.file.type,
					lastModified: previous.file.lastModified,
				}),
			};
			// Copying a large file into the store is the slow step.
			await saveTrackedMediaItem({
				projectId,
				id: toId,
				save: () => storageService.saveMediaItem(projectId, renamed),
				whenDeleting: "wait",
			});
			undo.push(() =>
				deleteTrackedMediaItem({
					projectId,
					id: toId,
					remove: () => storageService.deleteMediaItem(projectId, toId),
				})
			);
			inTime();
			useMediaStore.setState((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					item.id === fromId ? renamed : item
				),
			}));
			undo.push(() => {
				useMediaStore.setState((state) => ({
					mediaItems: state.mediaItems.map((item) =>
						item.id === toId ? previous : item
					),
				}));
			});
			// The verdict on a path is kept per path; a file renamed onto a
			// path another file had must be looked at again.
			forgetMediaAlphaInspection({ localPath });
			if (previous.localPath) {
				forgetMediaAlphaInspection({ localPath: previous.localPath });
			}
		}

		let clipsUpdated = await repointOpenScene({ fromId, toId, undo });
		clipsUpdated += await repointStoredScenes({
			projectId,
			fromId,
			toId,
			undo,
		});
		const stickersUpdated = await repointStickers({
			projectId,
			fromId,
			toId,
			undo,
		});
		// The last moment the asker may have given up: after this the rename
		// stands.
		inTime();

		if (previous) {
			try {
				await deleteTrackedMediaItem({
					projectId,
					id: fromId,
					remove: () => storageService.deleteMediaItem(projectId, fromId),
				});
			} catch (error) {
				debugWarn(
					"[MediaRename] The renamed item's old entry could not be removed:",
					error
				);
			}
		}
		await useProjectStore
			.getState()
			.markProjectContentChanged(projectId)
			.catch(() => undefined);
		return {
			mediaRenamed: previous !== undefined,
			clipsUpdated,
			stickersUpdated,
		};
	} catch (error) {
		for (const step of undo.reverse()) {
			try {
				await step();
			} catch (undoError) {
				debugWarn(
					"[MediaRename] A step of the rename could not be taken back:",
					undoError
				);
			}
		}
		throw error;
	}
}

/** The open scene: its clips are repointed in the store and saved at once. */
async function repointOpenScene({
	fromId,
	toId,
	undo,
}: {
	fromId: string;
	toId: string;
	undo: Undo[];
}): Promise<number> {
	const timeline = useTimelineStore.getState();
	const changed = timeline.repointMediaReferences({ fromId, toId });
	if (changed === 0) return 0;
	undo.push(async () => {
		const store = useTimelineStore.getState();
		store.repointMediaReferences({ fromId: toId, toId: fromId });
		await store.saveImmediate();
	});
	if (!(await timeline.saveImmediate())) {
		throw new Error("The timeline could not be saved with the renamed media");
	}
	return changed;
}

/** The scenes that are not open keep their timelines in storage only. */
async function repointStoredScenes({
	projectId,
	fromId,
	toId,
	undo,
}: {
	projectId: string;
	fromId: string;
	toId: string;
	undo: Undo[];
}): Promise<number> {
	const project = useProjectStore.getState().activeProject;
	if (project?.id !== projectId) return 0;
	let changed = 0;
	for (const scene of project.scenes ?? []) {
		if (scene.id === project.currentSceneId) continue;
		const tracks = await storageService.loadTimeline({
			projectId,
			sceneId: scene.id,
		});
		if (!tracks) continue;
		const repointed = repointMediaReferences({ tracks, fromId, toId });
		if (repointed.changed === 0) continue;
		await storageService.saveTimeline({
			projectId,
			tracks: repointed.tracks,
			sceneId: scene.id,
		});
		// As it was read: the scene's own tracks, before the rename.
		undo.push(() =>
			storageService.saveTimeline({ projectId, tracks, sceneId: scene.id })
		);
		changed += repointed.changed;
	}
	return changed;
}

/** A sticker whose media is gone is dropped on the next load, so it follows. */
async function repointStickers({
	projectId,
	fromId,
	toId,
	undo,
}: {
	projectId: string;
	fromId: string;
	toId: string;
	undo: Undo[];
}): Promise<number> {
	const stickers = useStickersOverlayStore.getState();
	const before = stickers.overlayStickers;
	let changed = 0;
	const overlayStickers = new Map(before);
	for (const [id, sticker] of overlayStickers) {
		if (sticker.mediaItemId !== fromId) continue;
		overlayStickers.set(id, { ...sticker, mediaItemId: toId });
		changed += 1;
	}
	if (changed === 0) return 0;
	useStickersOverlayStore.setState({ overlayStickers });
	undo.push(async () => {
		useStickersOverlayStore.setState({ overlayStickers: before });
		await stickers.saveToProject(projectId);
	});
	await stickers.saveToProject(projectId);
	return changed;
}
