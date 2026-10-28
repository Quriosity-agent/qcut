import type { TimelineTrack } from "@/types/timeline";

/** The element types a named track is checked for. */
type NamedTrackElementType =
	| "media"
	| "text"
	| "adjustment"
	| "captions"
	| "markdown"
	| "sticker"
	| "remotion";

/** The track types each element type may be placed on, as the store allows. */
const TRACK_TYPES_FOR_ELEMENT: Record<
	NamedTrackElementType,
	readonly string[]
> = {
	media: ["media", "audio"],
	text: ["text"],
	adjustment: ["adjustment"],
	captions: ["captions"],
	markdown: ["markdown"],
	sticker: ["sticker"],
	remotion: ["remotion"],
};

/**
 * The track a caller named for a single add, or undefined when none was
 * named (then the caller's helper picks or makes one). A named track is the
 * lane the caller asked for: one that does not exist (deleted, or emptied and
 * removed), or that cannot hold the element, is refused, because placing the
 * element on some other track would report success for an add nobody asked
 * for.
 */
export function resolveNamedTrack({
	tracks,
	trackId,
	elementType,
}: {
	tracks: readonly TimelineTrack[];
	trackId: unknown;
	elementType: NamedTrackElementType;
}): TimelineTrack | undefined {
	if (trackId === undefined || trackId === null || trackId === "") {
		return undefined;
	}
	const track = tracks.find((candidate) => candidate.id === trackId);
	if (!track) {
		throw new Error(
			`Track not found: ${String(trackId)}. It may have been deleted (a track emptied by a delete is removed); editor:timeline:export lists the current tracks.`
		);
	}
	const allowed = TRACK_TYPES_FOR_ELEMENT[elementType];
	if (!allowed.includes(track.type)) {
		throw new Error(
			`Track "${track.name}" is ${withArticle(track.type)} track; ${withArticle(elementType)} element needs ${withArticle(allowed.join(" or "))} track`
		);
	}
	return track;
}

function withArticle(word: string): string {
	return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}
