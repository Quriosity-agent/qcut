/**
 * The shape of a timeline manifest (`editor timeline apply`) and the pure
 * helpers that read it: aliases, id mapping, element and transition
 * collection, and read-back comparison.
 *
 * @module electron/native-pipeline/editor/editor-timeline-manifest
 */

export type JsonRecord = Record<string, unknown>;

export interface ManifestMedia extends JsonRecord {
	alias?: string;
	id?: string;
	mediaId?: string;
	path?: string;
	url?: string;
	filename?: string;
}

export interface ManifestElement extends JsonRecord {
	alias?: string;
	id?: string;
	elementId?: string;
	track?: string;
	trackId?: string;
	media?: string;
	source?: string;
	type?: string;
	startTime?: number;
	duration?: number;
	endTime?: number;
}

export interface ManifestTransition extends JsonRecord {
	track?: string;
	trackId?: string;
	from?: string;
	to?: string;
	fromElementId?: string;
	toElementId?: string;
	type?: string;
	presetId?: string;
	duration?: number;
}

export interface ManifestTrack extends JsonRecord {
	alias?: string;
	id?: string;
	trackId?: string;
	name?: string;
	type?: string;
	/**
	 * The track QCut cannot do without, as `timeline export` marks it. A
	 * replace gives it the project's own main track; without the mark the
	 * first media track takes that place.
	 */
	isMain?: boolean;
	/** Where the track goes; array order decides when the manifest is a whole timeline. */
	index?: number;
	colorLabel?: string | null;
	muted?: boolean;
	hidden?: boolean;
	locked?: boolean;
	/** Mixer settings of a track that carries audio (`timeline export` shape). */
	audio?: JsonRecord;
	elements?: ManifestElement[];
	transitions?: ManifestTransition[];
}

export interface TimelineManifest extends JsonRecord {
	projectId?: string;
	replace?: boolean;
	project?: JsonRecord;
	settings?: JsonRecord;
	media?: ManifestMedia[];
	tracks?: ManifestTrack[];
	elements?: ManifestElement[];
	updates?: ManifestElement[];
	transitions?: ManifestTransition[];
	/** The project's buses and master, as `timeline export` writes them. */
	mix?: JsonRecord;
	audioMix?: JsonRecord;
	export?: JsonRecord;
}

export interface TimelineSnapshot {
	tracks: Array<{
		id?: string;
		index: number;
		name: string;
		type: string;
		isMain?: boolean;
		colorLabel?: string;
		muted?: boolean;
		hidden?: boolean;
		locked?: boolean;
		elements: Array<Record<string, unknown> & { id: string }>;
		transitions?: Array<Record<string, unknown> & { id?: string }>;
	}>;
}

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(
	record: JsonRecord,
	key: string
): string | undefined {
	return typeof record[key] === "string" ? (record[key] as string) : undefined;
}

export function aliasFor(
	entry: { alias?: string; id?: string },
	fallback: string
): string {
	return entry.alias?.trim() || entry.id?.trim() || fallback;
}

export function mapReference(
	map: Map<string, string>,
	value: unknown
): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	return map.get(value) ?? value;
}

/**
 * Whether what the editor read back is what the manifest asked for. Numbers
 * agree within a millisecond-scale tolerance; an object agrees when every
 * field the manifest gave agrees (the editor may add defaults of its own, in
 * any key order); a list agrees item by item at the same length.
 */
export function valuesMatch(expected: unknown, actual: unknown): boolean {
	if (typeof expected === "number" && typeof actual === "number") {
		return Math.abs(expected - actual) < 0.001;
	}
	if (Array.isArray(expected)) {
		return (
			Array.isArray(actual) &&
			actual.length === expected.length &&
			expected.every((item, index) => valuesMatch(item, actual[index]))
		);
	}
	if (isRecord(expected)) {
		return (
			isRecord(actual) &&
			Object.entries(expected).every(
				([key, value]) => value === undefined || valuesMatch(value, actual[key])
			)
		);
	}
	return expected === actual;
}

/** Element types that are clips of a media file and can carry trims. */
export const MEDIA_FAMILY_TYPES = new Set(["media", "video", "audio", "image"]);

/**
 * The length a manifest element gives: `duration`, a clip's
 * `timelineDuration`, or `endTime − startTime`. A clip goes to the editor as
 * written, which reads its lengths the way `timeline export` writes them
 * (`duration` beside `timelineDuration` is the span after the trims) and
 * refuses trims that cannot be meant; another element has no trims, so an
 * `endTime` alone becomes its `duration`.
 */
export function manifestElementLength({
	element,
	alias,
}: {
	element: ManifestElement & { startTime: number };
	alias: string;
}): { isClip: boolean; span: number } {
	const isClip = MEDIA_FAMILY_TYPES.has(element.type ?? "");
	const span =
		typeof element.duration === "number"
			? element.duration
			: isClip && typeof element.timelineDuration === "number"
				? element.timelineDuration
				: typeof element.endTime === "number"
					? element.endTime - element.startTime
					: undefined;
	if (typeof span !== "number" || span <= 0) {
		throw new Error(
			`Element '${alias}' needs a length above 0: duration, timelineDuration (a clip) or endTime`
		);
	}
	return { isClip, span };
}

/**
 * The editor names an element it refuses by its place in the batch
 * ("Element 3 (…)", or "The clip (…)" when the batch holds one); the
 * manifest's alias says which one that is.
 */
export function withManifestAlias({
	error,
	chunk,
	offset,
}: {
	error: unknown;
	chunk: Array<{ element: ManifestElement }>;
	offset: number;
}): Error {
	const message = error instanceof Error ? error.message : String(error);
	const match = /^(?:Element (\d+)|The clip)\b/.exec(message);
	// "The clip" names the element only of a batch of one; in a longer batch
	// it is some other message and names no element.
	const index = match?.[1] === undefined ? 0 : Number(match[1]);
	const named = match?.[1] !== undefined || chunk.length === 1;
	const source = match && named ? chunk[index]?.element : undefined;
	if (!(match && source)) {
		return error instanceof Error ? error : new Error(message);
	}
	const alias = aliasFor(source, `element-${offset + index}`);
	return new Error(`Element '${alias}'${message.slice(match[0].length)}`);
}

export function collectElements(manifest: TimelineManifest): Array<{
	element: ManifestElement;
	trackRef?: string;
}> {
	const collected = (manifest.elements ?? []).map((element) => ({
		element,
		trackRef: element.track ?? element.trackId,
	}));
	for (const [trackIndex, track] of (manifest.tracks ?? []).entries()) {
		const trackRef = aliasFor(track, `track-${trackIndex}`);
		for (const element of track.elements ?? []) {
			collected.push({ element, trackRef });
		}
	}
	return collected;
}

export function collectTransitions(
	manifest: TimelineManifest
): ManifestTransition[] {
	const collected = [...(manifest.transitions ?? [])];
	for (const [trackIndex, track] of (manifest.tracks ?? []).entries()) {
		const trackRef = aliasFor(track, `track-${trackIndex}`);
		for (const transition of track.transitions ?? []) {
			collected.push({ ...transition, track: transition.track ?? trackRef });
		}
	}
	return collected;
}
