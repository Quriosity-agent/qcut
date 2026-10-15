import type {
	MediaPortraitAdjustments,
	MediaPortraitManualBody,
} from "../../../types/timeline";
import type { CompositeSettings } from "./portrait-composite-project";
import type { CompositeScenarioPass } from "./portrait-composite-runner";

const SMART_VALUES: MediaPortraitAdjustments["values"] = {
	body_adjust_SlimBody: 40,
	body_adjust_SlimWaist: 35,
	body_adjust_StretchLeg: 35,
};

const MANUAL_BODY: MediaPortraitManualBody = {
	stretch: { intensity: 20, upper: 0.8, bottom: 0.2 },
	slim: {
		intensity: 25,
		x: 0.5,
		y: 0.55,
		width: 0.5,
		height: 0.65,
		rotation: 0,
	},
	zoom: { intensity: 15, x: 0.5, y: 0.4, radius: 0.18 },
};

function bodyCompositePass({ id }: { id: string }): CompositeScenarioPass {
	if (id === "original")
		return { id, adjustments: { enabled: false, values: {} } };
	if (id !== "smart" && id !== "manual" && id !== "combined")
		throw new Error(`Unknown body composite evidence pass: ${id}`);
	return {
		id,
		adjustments: {
			enabled: true,
			engine: "native",
			values: id === "manual" ? {} : { ...SMART_VALUES },
			...(id === "smart" ? {} : { manualBody: structuredClone(MANUAL_BODY) }),
		},
	};
}

export function createBodyCompositeScenario({
	seconds = 6,
	samples,
	passes = ["original", "smart", "manual", "combined"],
}: {
	seconds?: number;
	samples?: number[];
	passes?: string[];
} = {}) {
	const fps = 30;
	const totalFrames = seconds * fps;
	if (
		!Number.isFinite(seconds) ||
		seconds > 60 ||
		!Number.isInteger(totalFrames) ||
		totalFrames < 4 ||
		totalFrames % 2 !== 0
	)
		throw new Error("Invalid body composite duration");
	const indices = [
		...new Set(
			samples ??
				[0, 1 / 12, 0.25, 5 / 12, 0.5, 7 / 12, 0.75, 1].map((fraction) =>
					Math.min(totalFrames - 1, Math.floor(totalFrames * fraction))
				)
		),
	].sort((left, right) => left - right);
	if (
		indices.length < 4 ||
		indices.length > 32 ||
		indices.some(
			(frame) => !Number.isInteger(frame) || frame < 0 || frame >= totalFrames
		)
	)
		throw new Error("Invalid body composite sample frame indices");
	if (passes.length === 0) throw new Error("No body composite passes selected");
	const settings: CompositeSettings = {
		width: 1080,
		height: 1920,
		fps,
		seconds,
		totalFrames,
		transitionSeconds: Math.min(1, seconds / 2),
		fit: "contain",
		samples: indices,
	};
	return {
		settings,
		passes: [...new Set(passes)].map((id) => bodyCompositePass({ id })),
		previewIndices: [indices[0], ...indices.slice(1).reverse()],
	};
}
