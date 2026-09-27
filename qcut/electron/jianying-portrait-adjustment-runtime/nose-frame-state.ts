import { isPortraitTrackingDiscontinuity } from "./tracking-session.js";

export interface PortraitNoseFrameIdentity {
	inputHash: string;
	parameters: string;
	timestampSeconds: number;
}

export function portraitNoseFrameAction({
	previous,
	current,
}: {
	previous?: PortraitNoseFrameIdentity;
	current: PortraitNoseFrameIdentity;
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
