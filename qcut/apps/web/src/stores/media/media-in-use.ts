/**
 * Whether the open project shows a media item anywhere.
 *
 * @module stores/media/media-in-use
 */
import { storageService } from "@/lib/storage/storage-service";
import type { TProject } from "@/types/project";
import { useStickersOverlayStore } from "../stickers-overlay-store";
import { tracksPlayMedia } from "../timeline/media-references";
import { useTimelineStore } from "../timeline/timeline-store";

/**
 * Whether the project plays the media: on the open scene's timeline, on a
 * stored scene's, or as a sticker over the preview.
 *
 * The stores are read as this project's. They hold whichever project is
 * open, and media ids repeat across projects: the caller makes sure the
 * project is the open one, and looks again after this has waited.
 */
export async function openProjectPlaysMedia({
	project,
	mediaId,
}: {
	project: TProject;
	mediaId: string;
}): Promise<boolean> {
	if (
		tracksPlayMedia({ tracks: useTimelineStore.getState()._tracks, mediaId })
	) {
		return true;
	}
	const { overlayStickers } = useStickersOverlayStore.getState();
	for (const sticker of overlayStickers.values()) {
		if (sticker.mediaItemId === mediaId) return true;
	}
	for (const scene of project.scenes ?? []) {
		if (scene.id === project.currentSceneId) continue;
		const tracks = await storageService.loadTimeline({
			projectId: project.id,
			sceneId: scene.id,
		});
		if (tracks && tracksPlayMedia({ tracks, mediaId })) return true;
	}
	return false;
}
