import { isPortraitTrackingDiscontinuity } from "./tracking-session.js";
import type { JianyingPortraitAdjustmentRuntimePackage } from "./jianying-portrait-adjustment-contract.js";
import { isJianying3DNosePackage } from "./nose-models.js";

export function portraitPackageNeedsStableFrame({
	runtimePackage,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}): boolean {
	return (
		isJianying3DNosePackage({ runtimePackage }) ||
		[
			"smile",
			"face",
			"eye-details",
			"small-face",
			"jawline",
			"skin-gan",
			"makeup",
			"brow-shape",
		].includes(runtimePackage)
	);
}

export interface PortraitFittingFrameIdentity {
	inputHash: string;
	parameters: string;
	timestampSeconds: number;
}

export function portraitFittingFrameAction({
	previous,
	current,
}: {
	previous?: PortraitFittingFrameIdentity;
	current: PortraitFittingFrameIdentity;
}): "render" | "reuse" | "reset" {
	if (!previous) return "render";
	if (
		isPortraitTrackingDiscontinuity({
			previousTimestampSeconds: previous.timestampSeconds,
			requestedTimestampSeconds: current.timestampSeconds,
		})
	)
		return "reset";
	if (
		previous.inputHash === current.inputHash &&
		previous.parameters === current.parameters
	)
		return "reuse";
	// Re-fitting a paused frame for every slider event advances native smoothing.
	if (
		current.timestampSeconds <= previous.timestampSeconds ||
		current.parameters !== previous.parameters
	)
		return "reset";
	return "render";
}
