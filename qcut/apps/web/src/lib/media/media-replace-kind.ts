/**
 * Which media can take a clip's place: a sound stays a sound and a picture a
 * picture, while video and stills replace each other. The editor API's
 * replace-media and the editor's own Replace share this rule (the Replace
 * button used to put a sound in place of a picture).
 *
 * @module lib/media/media-replace-kind
 */

import type { MediaType } from "@/stores/media/media-store-types";

/** Why media of type `next` cannot replace a clip's `current` media, if it cannot. */
export function mediaKindMismatch({
	current,
	next,
	nextName,
}: {
	current: MediaType;
	next: MediaType;
	nextName: string;
}): string | undefined {
	if ((current === "audio") === (next === "audio")) return undefined;
	const kind = (type: MediaType) => (type === "audio" ? "audio" : "a picture");
	return `${nextName} is ${kind(next)}; this clip's media is ${kind(current)}, so it takes ${current === "audio" ? "audio" : "video or an image"}`;
}
