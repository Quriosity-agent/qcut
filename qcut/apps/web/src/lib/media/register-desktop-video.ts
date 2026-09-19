import { platform } from "@qcut/platform-core";
import type { MediaItem } from "@/stores/media/media-store-types";

export async function registerDesktopVideo({
	projectId,
	mediaItem,
}: {
	projectId: string;
	mediaItem: MediaItem;
}): Promise<MediaItem> {
	if (mediaItem.type !== "video" || !mediaItem.localPath) return mediaItem;
	const desktop = platform();
	if (!desktop.isElectron) return mediaItem;
	const existing = await desktop.claude?.media.info(projectId, mediaItem.id);
	if (
		existing &&
		typeof existing === "object" &&
		"path" in existing &&
		existing.path === mediaItem.localPath
	) {
		// Reimporting the target itself would unlink the source in the IPC handler.
		return mediaItem;
	}
	const result = await desktop.mediaImport.import({
		projectId,
		mediaId: mediaItem.id,
		sourcePath: mediaItem.localPath,
		// saveTemp paths can disappear between sessions; the project owns this copy.
		preferSymlink: false,
	});
	if (!result?.success || !result.targetPath) {
		throw new Error(
			result?.error || "Could not register video in project media"
		);
	}
	return { ...mediaItem, localPath: result.targetPath, isLocalFile: true };
}
