import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import { NativePortraitSourceWindowError } from "@/lib/portrait/portrait-temporal-policy";
import { hasIndependentBodyVideoAdjustments } from "@/lib/portrait/independent-body-video";
import {
	independentPortraitIssueMessage,
	independentPortraitRequest,
} from "@/lib/portrait/independent-portrait-adjustments";
import { resolveMediaVisualProperties } from "@/lib/video/video-properties";
import {
	independentPortraitDimensionsValid,
	portraitProcessingSize,
} from "@/lib/portrait/portrait-processing-size";
import type {
	MediaElement,
	MediaPortraitAdjustments,
	TimelineTrack,
} from "@/types/timeline";

class IndependentPortraitExportError extends Error {
	constructor({ cause }: { cause: unknown }) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "IndependentPortraitExportError";
	}
}

export function rethrowIndependentPortraitExportError({
	error,
	adjustments,
	signal,
}: {
	error: unknown;
	adjustments?: MediaPortraitAdjustments;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	if (error instanceof NativePortraitSourceWindowError) throw error;
	if (error instanceof IndependentPortraitExportError) throw error;
	if (
		adjustments?.engine === "independent" &&
		hasMediaPortraitAdjustments({ adjustments })
	)
		throw new IndependentPortraitExportError({ cause: error });
}

export async function drawPortraitExportFrame({
	draw,
	adjustments,
	signal,
}: {
	draw: () => Promise<void>;
	adjustments?: MediaPortraitAdjustments;
	signal?: AbortSignal;
}) {
	try {
		signal?.throwIfAborted();
		await draw();
		signal?.throwIfAborted();
	} catch (error) {
		rethrowIndependentPortraitExportError({ error, adjustments, signal });
		throw error;
	}
}

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
 * frame renders, before initializing encoders or processing any clip.
 */
export async function prepareIndependentPortraitExport({
	tracks,
	width,
	height,
}: {
	tracks: readonly TimelineTrack[];
	width: number;
	height: number;
}): Promise<{ clips: number }> {
	const elements = independentPortraitElements({
		elements: tracks.flatMap((track) =>
			track.elements.filter(
				(element): element is MediaElement => element.type === "media"
			)
		),
	});
	if (elements.length === 0) return { clips: 0 };
	if (
		![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
	)
		throw new Error("自研美颜导出需要有效的画面尺寸");
	const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
	if (!inspect) throw new Error("自研美颜需要 QCut 桌面版");
	const status = await inspect();
	if (!status.available)
		throw new Error(`自研美颜引擎不可用：${status.message}`);
	for (const element of elements) {
		const adjustments =
			resolveMediaVisualProperties(element).portraitAdjustments;
		const requiresCoreMLBody =
			adjustments.bodyVideoProfile === "swing-coreml-v1" &&
			hasIndependentBodyVideoAdjustments({ adjustments });
		const bodyProfile = adjustments.bodyVideoProfile
			? status.bodyVideoProfiles?.[adjustments.bodyVideoProfile]
			: undefined;
		if (
			requiresCoreMLBody &&
			(status.bodyVideo !== true || bodyProfile?.available !== true)
		) {
			const reason =
				status.bodyVideo !== true
					? "当前引擎不支持视频美体序列"
					: (bodyProfile?.message ?? "请配置 CoreML 视频序列运行环境");
			throw new Error(
				`片段「${element.name}」的 CoreML 视频美体不可用：${reason}`
			);
		}
		const processingSize = portraitProcessingSize({
			width,
			height,
			sourceWidth: width,
			sourceHeight: height,
			adjustments,
		});
		if (!independentPortraitDimensionsValid(processingSize))
			throw new Error(
				`片段「${element.name}」无法使用自研美颜处理当前画面尺寸`
			);
		const converted = independentPortraitRequest({
			adjustments,
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
