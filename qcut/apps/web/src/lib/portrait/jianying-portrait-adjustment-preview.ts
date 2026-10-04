import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { reportColorDegradation } from "@/lib/color/color-degradation";
import type { PortraitSourcePreRollReader } from "./portrait-source-preroll";
import type { JianyingPortraitAdjustmentRenderResult } from "@/types/electron/api-jianying-portrait-adjustment";

function validateRenderedPortrait({
	result,
	source,
}: {
	result: JianyingPortraitAdjustmentRenderResult;
	source: ImageData;
}) {
	if (
		result.provider !== "jianying-local-swing-v1" ||
		result.width !== source.width ||
		result.height !== source.height ||
		result.rgba.byteLength !== source.data.byteLength
	)
		throw new Error("剪映美颜美体返回了不匹配的画面");
}

export async function renderJianyingPortraitAdjustmentPreview({
	source,
	adjustments,
	frameNumber,
	sourceKey,
	timestampSeconds,
	readSourcePreRoll,
	signal,
}: {
	source: ImageData;
	adjustments?: MediaPortraitAdjustments;
	frameNumber?: number;
	sourceKey?: string;
	timestampSeconds?: number;
	readSourcePreRoll?: PortraitSourcePreRollReader;
	signal?: AbortSignal;
}): Promise<ImageData | null> {
	if (!adjustments || !hasMediaPortraitAdjustments({ adjustments })) {
		return source;
	}
	const api = window.electronAPI?.jianyingPortraitAdjustment;
	if (!api) return null;
	try {
		signal?.throwIfAborted();
		const request = {
			width: source.width,
			height: source.height,
			rgba: new Uint8Array(source.data),
			adjustments: structuredClone(adjustments),
			...(frameNumber === undefined ? {} : { frameNumber }),
			...(sourceKey ? { sourceKey } : {}),
			...(timestampSeconds === undefined ? {} : { timestampSeconds }),
		};
		let result = await api.render(request);
		signal?.throwIfAborted();
		validateRenderedPortrait({ result, source });
		if (
			result.needsSourcePreRoll &&
			readSourcePreRoll &&
			sourceKey &&
			timestampSeconds !== undefined
		) {
			const sourcePreRoll = await readSourcePreRoll({
				width: source.width,
				height: source.height,
				sourceKey,
				timestampSeconds,
				signal,
			});
			signal?.throwIfAborted();
			if (sourcePreRoll)
				result = await api.render({ ...request, sourcePreRoll });
			signal?.throwIfAborted();
			validateRenderedPortrait({ result, source });
		}
		return new ImageData(
			Uint8ClampedArray.from(result.rgba),
			result.width,
			result.height
		);
	} catch (cause) {
		if (signal?.aborted) throw cause;
		reportColorDegradation({
			reason: "jianying-portrait-adjustment-fallback",
			detail: cause instanceof Error ? cause.message : String(cause),
		});
		return null;
	}
}
