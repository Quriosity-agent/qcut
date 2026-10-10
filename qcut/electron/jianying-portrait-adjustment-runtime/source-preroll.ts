import {
	PORTRAIT_SOURCE_PRE_ROLL_LIMITS,
	type JianyingPortraitAdjustmentRenderRequest,
	type JianyingPortraitSourcePreRoll,
} from "./jianying-portrait-adjustment-contract.js";

export function canRecoverPortraitSource({
	request,
}: {
	request: Pick<
		JianyingPortraitAdjustmentRenderRequest,
		"sourceKey" | "timestampSeconds" | "adjustments"
	>;
}): boolean {
	const { adjustments, sourceKey, timestampSeconds } = request;
	return Boolean(
		sourceKey &&
			timestampSeconds !== undefined &&
			Number.isFinite(timestampSeconds) &&
			timestampSeconds > 0 &&
			adjustments.enabled &&
			!adjustments.faces?.length &&
			adjustments.faceTarget?.mode !== "single" &&
			!adjustments.manualRetouch?.strokes.length &&
			!adjustments.manualBody
	);
}

export function parsePortraitSourcePreRoll({
	value,
	request,
}: {
	value: unknown;
	request: Pick<
		JianyingPortraitAdjustmentRenderRequest,
		"width" | "height" | "sourceKey" | "timestampSeconds" | "adjustments"
	>;
}): JianyingPortraitSourcePreRoll | undefined {
	if (value === undefined) return;
	if (!canRecoverPortraitSource({ request })) {
		throw new Error(
			"Portrait source pre-roll requires a timed, global video adjustment"
		);
	}
	const candidate = value as Partial<JianyingPortraitSourcePreRoll> | null;
	const frames = candidate?.frames;
	if (
		candidate?.sourceKey !== request.sourceKey ||
		!Array.isArray(frames) ||
		frames.length === 0 ||
		frames.length > PORTRAIT_SOURCE_PRE_ROLL_LIMITS.frames ||
		frames.length * request.width * request.height * 4 >
			PORTRAIT_SOURCE_PRE_ROLL_LIMITS.bytes
	) {
		throw new Error("Invalid portrait source pre-roll identity or size");
	}
	const targetTimestamp = request.timestampSeconds as number;
	let previousTimestamp = -1;
	for (const frame of frames) {
		if (
			!frame ||
			!Number.isFinite(frame.timestampSeconds) ||
			frame.timestampSeconds < 0 ||
			frame.timestampSeconds <= previousTimestamp ||
			frame.timestampSeconds >= targetTimestamp ||
			targetTimestamp - frame.timestampSeconds >
				PORTRAIT_SOURCE_PRE_ROLL_LIMITS.seconds + 1e-6 ||
			!(frame.rgba instanceof Uint8Array) ||
			frame.rgba.byteLength !== request.width * request.height * 4
		) {
			throw new Error("Invalid portrait source pre-roll frame or timestamp");
		}
		previousTimestamp = frame.timestampSeconds;
	}
	return { sourceKey: request.sourceKey as string, frames };
}
