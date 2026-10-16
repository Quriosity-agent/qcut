/**
 * Export policy for adjustment layers.
 *
 * The native export grades an adjustment layer's colour and opacity in its
 * own pass, but it cannot shape that grade with masks or run multi-pass
 * programs; a timeline holding such a layer exports through the renderer's
 * canvas engine, as filter stacks do, instead of dropping the mask silently.
 */

interface AdjustmentTimelineElement {
	type?: string;
	hidden?: boolean;
	masks?: unknown;
	colorSettings?: unknown;
}

interface AdjustmentTimeline {
	tracks: Array<{ hidden?: boolean; elements: AdjustmentTimelineElement[] }>;
}

function hasActiveMask({ masks }: { masks: unknown }): boolean {
	if (!Array.isArray(masks)) return false;
	return masks.some((mask) => {
		if (typeof mask !== "object" || mask === null) return false;
		const entry = mask as Record<string, unknown>;
		return entry.enabled !== false && entry.type !== "none";
	});
}

function hasMultiPassGrade({ color }: { color: unknown }): boolean {
	if (typeof color !== "object" || color === null) return false;
	const multiPass = (color as Record<string, unknown>).multiPass;
	return (
		typeof multiPass === "object" &&
		multiPass !== null &&
		(multiPass as Record<string, unknown>).enabled === true
	);
}

export function timelineRequiresRendererAdjustmentLayerExport({
	timeline,
}: {
	timeline: AdjustmentTimeline;
}): boolean {
	for (const track of timeline.tracks) {
		if (track.hidden) continue;
		for (const element of track.elements) {
			if (element.type !== "adjustment" || element.hidden) continue;
			if (
				hasActiveMask({ masks: element.masks }) ||
				hasMultiPassGrade({ color: element.colorSettings })
			) {
				return true;
			}
		}
	}
	return false;
}
