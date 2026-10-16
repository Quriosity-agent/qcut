/**
 * Export policy for animated colour grades.
 *
 * The native engine bakes a static basic grade into a cube of the preview's
 * own pixel maths, so it matches. A keyframed grade has to run FFmpeg's
 * per-frame `eq`, which is one affine map per frame: it cannot lift shadows
 * by luma, fade toward grey, or shape highlights, whites and blacks the way
 * the preview does. A timeline whose animated grade uses those controls
 * exports through the renderer's canvas engine instead of coming out
 * visibly different; animated exposure, brightness, contrast, white balance
 * and saturation stay on the native path, which `eq` and `hue` carry well.
 */

const TONAL_PROPERTIES = [
	"shadows",
	"highlights",
	"whites",
	"blacks",
	"fade",
] as const;

interface ColorTimelineElement {
	type?: string;
	hidden?: boolean;
	colorSettings?: unknown;
}

interface ColorTimeline {
	tracks: Array<{ hidden?: boolean; elements: ColorTimelineElement[] }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keyframe lists of the grade, by property path such as `basic.shadows`. */
function keyframesOf({
	color,
}: {
	color: Record<string, unknown>;
}): Record<string, unknown[]> {
	if (!isRecord(color.keyframes)) return {};
	return Object.fromEntries(
		Object.entries(color.keyframes).filter(
			(entry): entry is [string, unknown[]] =>
				Array.isArray(entry[1]) && entry[1].length > 0
		)
	);
}

/** Whether the basic grade changes over time (any basic or smart-intensity keyframe). */
export function basicGradeIsAnimated({ color }: { color: unknown }): boolean {
	if (!isRecord(color)) return false;
	return Object.keys(keyframesOf({ color })).some(
		(property) =>
			property.startsWith("basic.") || property === "smart.intensity"
	);
}

/**
 * Whether shadows, highlights, whites, blacks or fade do anything: a
 * non-zero static value, or any keyframe that is not zero.
 */
export function tonalControlsInUse({ color }: { color: unknown }): boolean {
	if (!isRecord(color)) return false;
	const basic = isRecord(color.basic) ? color.basic : {};
	if (basic.enabled === false) return false;
	const keyframes = keyframesOf({ color });
	return TONAL_PROPERTIES.some((property) => {
		const value = basic[property];
		if (typeof value === "number" && value !== 0) return true;
		return (keyframes[`basic.${property}`] ?? []).some(
			(keyframe) =>
				isRecord(keyframe) &&
				typeof keyframe.value === "number" &&
				keyframe.value !== 0
		);
	});
}

/**
 * Whether a visible clip or adjustment layer animates its basic grade while
 * using the tonal controls the per-frame `eq` path cannot reproduce.
 */
export function timelineRequiresRendererColorKeyframeExport({
	timeline,
}: {
	timeline: ColorTimeline;
}): boolean {
	for (const track of timeline.tracks) {
		if (track.hidden) continue;
		for (const element of track.elements) {
			if (element.hidden) continue;
			if (
				element.type !== "media" &&
				element.type !== "video" &&
				element.type !== "adjustment"
			) {
				continue;
			}
			const color = element.colorSettings;
			if (!isRecord(color) || color.enabled === false) continue;
			if (basicGradeIsAnimated({ color }) && tonalControlsInUse({ color })) {
				return true;
			}
		}
	}
	return false;
}
