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
}

export interface ProjectMediaRenameResult {
	/** The editor held the item and re-keyed it. */
	mediaRenamed: boolean;
	/** Clips now pointing at the new id, over every scene. */
	clipsUpdated: number;
	stickersUpdated: number;
}

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
 * The new item is stored first, so a failure there leaves the project as it
 * was and the caller can put the file back. The old entry is removed last;
 * if that fails the rename still stands and only a stale entry is left.
 */
export async function renameProjectMedia({
	projectId,
	fromId,
	toId,
	name,
	localPath,
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

	let renamed: MediaItem | undefined;
	if (previous) {
		renamed = {
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
		const stored = renamed;
		await saveTrackedMediaItem({
			projectId,
			id: toId,
			save: () => storageService.saveMediaItem(projectId, stored),
			whenDeleting: "wait",
		});
		useMediaStore.setState((state) => ({
			mediaItems: state.mediaItems.map((item) =>
				item.id === fromId ? stored : item
			),
		}));
		// The verdict on a path is kept per path; a file renamed onto a path
		// another file had must be looked at again.
		forgetMediaAlphaInspection({ localPath });
		if (previous.localPath) {
			forgetMediaAlphaInspection({ localPath: previous.localPath });
		}
	}

	const timeline = useTimelineStore.getState();
	let clipsUpdated = timeline.repointMediaReferences({ fromId, toId });
	if (clipsUpdated > 0) await timeline.saveImmediate();
	clipsUpdated += await repointStoredScenes({ projectId, fromId, toId });
	const stickersUpdated = await repointStickers({ projectId, fromId, toId });

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
	return { mediaRenamed: renamed !== undefined, clipsUpdated, stickersUpdated };
}

/** The scenes that are not open keep their timelines in storage only. */
async function repointStoredScenes({
	projectId,
	fromId,
	toId,
}: {
	projectId: string;
	fromId: string;
	toId: string;
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
		changed += repointed.changed;
	}
	return changed;
}

/** A sticker whose media is gone is dropped on the next load, so it follows. */
async function repointStickers({
	projectId,
	fromId,
	toId,
}: {
	projectId: string;
	fromId: string;
	toId: string;
}): Promise<number> {
	const stickers = useStickersOverlayStore.getState();
	let changed = 0;
	const overlayStickers = new Map(stickers.overlayStickers);
	for (const [id, sticker] of overlayStickers) {
		if (sticker.mediaItemId !== fromId) continue;
		overlayStickers.set(id, { ...sticker, mediaItemId: toId });
		changed += 1;
	}
	if (changed === 0) return 0;
	useStickersOverlayStore.setState({ overlayStickers });
	await stickers.saveToProject(projectId);
	return changed;
}
