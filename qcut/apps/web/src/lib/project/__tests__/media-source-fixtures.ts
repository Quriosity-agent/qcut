import type { MediaItem } from "@/stores/media/media-store-types";
import type { ProjectFolderFileInfo } from "@/types/electron";

/** What the tests of `media-source-refresh` build their folders and items from. */
export const FOLDER = "/Users/me/Documents/QCut/Projects/p1/media";

export function diskFile(
	overrides: Partial<ProjectFolderFileInfo> = {}
): ProjectFolderFileInfo {
	return {
		name: "shake.mp4",
		path: `${FOLDER}/shake.mp4`,
		relativePath: "media/shake.mp4",
		type: "video",
		size: 400,
		modifiedAt: 5000,
		isDirectory: false,
		...overrides,
	};
}

/** An item the editor copied when the file was `bytes` long. */
export function mediaItem({
	bytes = 400,
	...overrides
}: Partial<MediaItem> & { bytes?: number } = {}): MediaItem {
	return {
		id: "media_shake",
		name: "shake.mp4",
		type: "video",
		file: new File([new Uint8Array(bytes)], "shake.mp4", {
			type: "video/mp4",
		}),
		url: "blob:old",
		localPath: `${FOLDER}/shake.mp4`,
		duration: 2,
		width: 1920,
		height: 1080,
		thumbnailUrl: "data:old-thumbnail",
		...overrides,
	} as MediaItem;
}

/** The record an item carries of the file it was copied from. */
export const recorded = (size: number, modifiedAt: number) => ({
	metadata: { source: "upload", sourceFile: { size, modifiedAt } },
});
