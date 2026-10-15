import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import type { MediaPortraitAdjustments } from "@/types/timeline";

export interface PortraitTemporalOptions {
	portraitTemporalMode?: "recovery" | "source-window";
}

export class NativePortraitSourceWindowError extends Error {
	constructor({ cause }: { cause: unknown }) {
		super(
			`原生美颜源帧历史渲染失败：${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
		this.name = "NativePortraitSourceWindowError";
	}
}

export function canUseNativePortraitSourceWindow({
	adjustments,
	stabilization = 0,
}: {
	adjustments?: MediaPortraitAdjustments;
	stabilization?: number;
}): boolean {
	return Boolean(
		adjustments &&
			hasMediaPortraitAdjustments({ adjustments }) &&
			adjustments.engine !== "independent" &&
			adjustments.faceTarget?.mode !== "single" &&
			!adjustments.faces?.length &&
			!adjustments.manualRetouch?.strokes.length &&
			stabilization === 0
	);
}

export function portraitSourceWindowKey({ sourceKey }: { sourceKey: string }) {
	const prefix = "source-window-v1:";
	if (!sourceKey || sourceKey.length + prefix.length > 512)
		throw new Error("Portrait source-window identity is missing or too long");
	return `${prefix}${sourceKey}`;
}
