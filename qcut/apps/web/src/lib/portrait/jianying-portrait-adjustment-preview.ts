import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { reportColorDegradation } from "@/lib/color/color-degradation";
import type { PortraitSourcePreRollReader } from "./portrait-source-preroll";
import type { JianyingPortraitAdjustmentRenderResult } from "@/types/electron/api-jianying-portrait-adjustment";
import {
	canUseNativePortraitSourceWindow,
	NativePortraitSourceWindowError,
	portraitSourceWindowKey,
	type PortraitTemporalOptions,
} from "./portrait-temporal-policy";

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
	portraitTemporalMode,
	signal,
}: {
	source: ImageData;
	adjustments?: MediaPortraitAdjustments;
	frameNumber?: number;
	sourceKey?: string;
	timestampSeconds?: number;
	readSourcePreRoll?: PortraitSourcePreRollReader;
	signal?: AbortSignal;
} & PortraitTemporalOptions): Promise<ImageData | null> {
	if (!adjustments || !hasMediaPortraitAdjustments({ adjustments })) {
		return source;
	}
	const api = window.electronAPI?.jianyingPortraitAdjustment;
	const deterministic = portraitTemporalMode === "source-window";
	if (!api) {
		if (deterministic)
			throw new NativePortraitSourceWindowError({
				cause: "Portrait source-window renderer is unavailable",
			});
		return null;
	}
	try {
		signal?.throwIfAborted();
		if (
			deterministic &&
			(!canUseNativePortraitSourceWindow({ adjustments }) ||
				!sourceKey ||
				timestampSeconds === undefined ||
				!Number.isFinite(timestampSeconds) ||
				timestampSeconds < 0 ||
				!readSourcePreRoll)
		)
			throw new Error(
				"Portrait source-window requires a supported timed local video adjustment"
			);
		const renderSourceKey = deterministic
			? portraitSourceWindowKey({ sourceKey: sourceKey as string })
			: sourceKey;
		const request = {
			width: source.width,
			height: source.height,
			rgba: new Uint8Array(source.data),
			adjustments: structuredClone(adjustments),
			...(frameNumber === undefined ? {} : { frameNumber }),
			...(renderSourceKey ? { sourceKey: renderSourceKey } : {}),
			...(timestampSeconds === undefined ? {} : { timestampSeconds }),
		};
		const history = deterministic
			? await readSourcePreRoll!({
					width: source.width,
					height: source.height,
					sourceKey: renderSourceKey as string,
					timestampSeconds: timestampSeconds as number,
					strict: true,
					signal,
				})
			: undefined;
		signal?.throwIfAborted();
		if (deterministic && (!history || history.sourceKey !== renderSourceKey))
			throw new Error(
				"Portrait source-window decoder did not return a history result"
			);
		let result = await api.render({
			...request,
			...(deterministic ? { freshTracking: true } : {}),
			...(history?.frames.length ? { sourcePreRoll: history } : {}),
		});
		signal?.throwIfAborted();
		validateRenderedPortrait({ result, source });
		if (
			!deterministic &&
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
		if (deterministic) throw new NativePortraitSourceWindowError({ cause });
		reportColorDegradation({
			reason: "jianying-portrait-adjustment-fallback",
			detail: cause instanceof Error ? cause.message : String(cause),
		});
		return null;
	}
}
