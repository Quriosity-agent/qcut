import type { TimelineTrack } from "@/types/timeline";

/**
 * Points every clip that plays media `fromId` at `toId`: media clips, and
 * the stickers on the timeline, which name their picture by media id too.
 *
 * A media id follows its file name, so a file renamed in the project folder
 * comes back under a new id. The clips have to follow, or they play an item
 * that is no longer in the project: the preview still finds its picture, the
 * native export does not, and the clip is missing from the file.
 *
 * Tracks and clips that do not change keep their objects, so nothing that
 * watches the timeline sees them as edited. A locked track is repointed too:
 * this keeps a reference whole, it is not an edit of the clip.
 */
/** A clip plays the media: a media clip, or a sticker on the timeline. */
function playsMedia(
	element: TimelineTrack["elements"][number],
	mediaId: string
): boolean {
	return (
		(element.type === "media" || element.type === "sticker") &&
		element.mediaId === mediaId
	);
}

/** Whether any clip on the tracks plays the media. */
export function tracksPlayMedia({
	tracks,
	mediaId,
}: {
	tracks: TimelineTrack[];
	mediaId: string;
}): boolean {
	return tracks.some((track) =>
		track.elements.some((element) => playsMedia(element, mediaId))
	);
}

export function repointMediaReferences({
	tracks,
	fromId,
	toId,
}: {
	tracks: TimelineTrack[];
	fromId: string;
	toId: string;
}): { tracks: TimelineTrack[]; changed: number } {
	if (fromId === toId) return { tracks, changed: 0 };
	let changed = 0;
	const repointed = tracks.map((track) => {
		let trackChanged = false;
		const elements = track.elements.map((element) => {
			if (!playsMedia(element, fromId)) return element;
			trackChanged = true;
			changed += 1;
			return { ...element, mediaId: toId };
		});
		return trackChanged ? { ...track, elements } : track;
	});
	return { tracks: changed > 0 ? repointed : tracks, changed };
}
