import { useMediaStore } from "@/stores/media/media-store";
import type { ClaudeBatchAddElementRequest } from "../../../../../electron/types/claude-api";

/**
 * The name a deterministic media id encodes: the main process names a file it
 * imports `media_<base64url of the file name>`.
 */
export function decodeDeterministicMediaSourceName({
	sourceId,
}: {
	sourceId: string;
}): string | null {
	try {
		if (!sourceId.startsWith("media_")) {
			return null;
		}
		const encodedName = sourceId.slice("media_".length);
		if (!encodedName) {
			return null;
		}
		const base64 = encodedName.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
		const binary = window.atob(padded);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

export function resolveMediaIdForBatchElement({
	element,
}: {
	element: Pick<
		ClaudeBatchAddElementRequest,
		"mediaId" | "sourceId" | "sourceName"
	>;
}): string | null {
	const { mediaItems } = useMediaStore.getState();

	if (element.mediaId) {
		const byMediaId = mediaItems.find((item) => item.id === element.mediaId);
		if (byMediaId) {
			return byMediaId.id;
		}

		const decodedMediaIdName = decodeDeterministicMediaSourceName({
			sourceId: element.mediaId,
		});
		if (decodedMediaIdName) {
			const byDecodedMediaIdName = mediaItems.find(
				(item) => item.name === decodedMediaIdName
			);
			if (byDecodedMediaIdName) {
				return byDecodedMediaIdName.id;
			}
		}
	}

	if (element.sourceId) {
		const bySourceId = mediaItems.find((item) => item.id === element.sourceId);
		if (bySourceId) {
			return bySourceId.id;
		}

		const decodedName = decodeDeterministicMediaSourceName({
			sourceId: element.sourceId,
		});
		if (decodedName) {
			const byDecodedName = mediaItems.find(
				(item) => item.name === decodedName
			);
			if (byDecodedName) {
				return byDecodedName.id;
			}
		}
	}

	if (element.sourceName) {
		const byName = mediaItems.find((item) => item.name === element.sourceName);
		if (byName) {
			return byName.id;
		}
	}

	return null;
}
