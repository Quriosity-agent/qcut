import type { MediaItem } from "@/stores/media/media-store-types";

/**
 * Returns the media bytes as a File. Items restored from storage may carry
 * an empty placeholder File and only a URL; those are fetched once here.
 */
export async function resolveMediaFile({
	mediaItem,
}: {
	mediaItem: Pick<MediaItem, "file" | "url" | "name">;
}): Promise<File> {
	if (mediaItem.file && mediaItem.file.size > 0) return mediaItem.file;
	if (!mediaItem.url) {
		throw new Error(`Media "${mediaItem.name}" has no readable file or URL.`);
	}
	const response = await fetch(mediaItem.url);
	if (!response.ok) {
		throw new Error(
			`Media "${mediaItem.name}" could not be read (${response.status}).`
		);
	}
	const blob = await response.blob();
	return new File([blob], mediaItem.name, {
		type: blob.type || mediaItem.file?.type || "video/mp4",
	});
}
