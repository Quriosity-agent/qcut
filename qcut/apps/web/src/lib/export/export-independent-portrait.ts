import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import {
	independentPortraitIssueMessage,
	independentPortraitRequest,
} from "@/lib/portrait/independent-portrait-adjustments";
import { resolveMediaVisualProperties } from "@/lib/video/video-properties";
import type { MediaElement, TimelineTrack } from "@/types/timeline";

function independentPortraitElements({
	elements,
}: {
	elements: readonly MediaElement[];
}): MediaElement[] {
	return elements.flatMap((element) => [
		...(element.portraitAdjustments?.engine === "independent" &&
		hasMediaPortraitAdjustments({
			adjustments: resolveMediaVisualProperties(element).portraitAdjustments,
		})
			? [element]
			: []),
		...independentPortraitElements({
			elements: (element.compound?.clips ?? []).map((clip) => clip.element),
		}),
	]);
}

/**
 * Checks every clip that uses the independent portrait engine before the first
 * frame renders. The engine needs about ten seconds a frame, so a missing
 * engine or an unsupported edit must stop the export now, not minutes in.
 * Returns how many clips use it so progress can say why export is slow.
 */
export async function prepareIndependentPortraitExport({
	tracks,
}: {
	tracks: readonly TimelineTrack[];
}): Promise<{ clips: number }> {
	const elements = independentPortraitElements({
		elements: tracks.flatMap((track) =>
			track.elements.filter(
				(element): element is MediaElement => element.type === "media"
			)
		),
	});
	if (elements.length === 0) return { clips: 0 };
	const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
	if (!inspect) throw new Error("自研美颜需要 QCut 桌面版");
	const status = await inspect();
	if (!status.available)
		throw new Error(`自研美颜引擎不可用：${status.message}`);
	for (const element of elements) {
		const converted = independentPortraitRequest({
			adjustments: resolveMediaVisualProperties(element).portraitAdjustments,
			support: status,
		});
		if ("issue" in converted)
			throw new Error(
				`片段「${element.name}」${independentPortraitIssueMessage({
					issue: converted.issue,
				})}`
			);
	}
	return { clips: elements.length };
}
