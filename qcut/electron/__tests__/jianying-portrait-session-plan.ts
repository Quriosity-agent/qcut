import type {
	JianyingPortraitAdjustmentRenderRequest,
	JianyingPortraitAdjustmentRenderResult,
	MediaPortraitAdjustments,
} from "../jianying-portrait-adjustment-contract";
import { compareRgbaPixels } from "../beauty-lab/beauty-lab-rgba-metrics";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../jianying-portrait-adjustment-runtime/skin-tone-catalog";

export interface PortraitSessionProvider {
	render: (
		request: JianyingPortraitAdjustmentRenderRequest
	) => Promise<JianyingPortraitAdjustmentRenderResult>;
	clear: () => Promise<void>;
}

export interface PortraitSessionStep {
	id: string;
	frame: number;
	sourceKey: string;
	time: number;
	adjustments: MediaPortraitAdjustments;
	comparison: "exact-reset" | "original" | "temporal-diagnostic";
	baseline: { frame: number; time: number }[];
	clearBefore?: boolean;
	repeatOf?: string;
}

const eye: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_EnlargeEye: 60 },
};
export const SESSION_COMBINED_ADJUSTMENTS: MediaPortraitAdjustments = {
	enabled: true,
	skinToneResourceId: "7408757645705760000",
	values: {
		face_adjust_EnlargeEye: 45,
		face_adjust_Smooth: 30,
		face_adjust_skin_Intensity: 60,
		face_adjust_skin_ColdWarm: 25,
	},
	makeup: { lip: { cardId: "lip-soft-pink", intensity: 80 } },
};

export function buildPortraitSessionPlan({ times }: { times: number[] }) {
	if (
		times.length !== 10 ||
		times.some(
			(time, index) =>
				!Number.isFinite(time) ||
				time < 0 ||
				(index > 0 && (time <= times[index - 1] || time - times[index - 1] > 1))
		)
	)
		throw new Error("Expected ten increasing adjacent frame timestamps");
	const steps: PortraitSessionStep[] = [];
	const add = ({
		id,
		frame,
		time = times[frame],
		sourceKey = "rolling-A",
		adjustments = eye,
		comparison = "exact-reset",
		baseline = [{ frame, time }],
		...rest
	}: Pick<PortraitSessionStep, "id" | "frame"> &
		Partial<PortraitSessionStep>) =>
		steps.push({
			id,
			frame,
			time,
			sourceKey,
			adjustments,
			comparison,
			baseline,
			...rest,
		});
	for (let frame = 0; frame < 10; frame++)
		add({
			id: `rolling-${frame}`,
			frame,
			comparison: frame === 0 ? "exact-reset" : "temporal-diagnostic",
		});
	add({
		id: "paused-cache-hit",
		frame: 9,
		repeatOf: "rolling-9",
		comparison: "temporal-diagnostic",
	});
	// Frame 3 is outside the provider's four-entry output cache.
	add({ id: "backward-seek", frame: 3 });
	add({
		id: "after-backward-seek",
		frame: 4,
		baseline: [3, 4].map((frame) => ({ frame, time: times[frame] })),
	});
	add({
		id: "cached-forward-seek",
		frame: 9,
		repeatOf: "rolling-9",
		comparison: "temporal-diagnostic",
	});
	add({ id: "backward-after-cache-hit", frame: 5 });
	add({ id: "forward-gap", frame: 6, time: times[9] + 2 });
	const afterGap = [6, 7, 8].map((frame) => ({
		frame,
		time: times[9] + 2 + (times[frame] - times[6]),
	}));
	add({
		id: "after-forward-gap",
		frame: 7,
		time: afterGap[1].time,
		baseline: afterGap.slice(0, 2),
	});
	add({ id: "fresh-source-B", frame: 8, sourceKey: "fresh-B" });
	add({
		id: "revisit-live-A",
		frame: 8,
		time: afterGap[2].time,
		baseline: afterGap,
	});
	for (let index = 0; index < 4; index++)
		add({
			id: `scope-pressure-${index}`,
			frame: index,
			sourceKey: `pressure-${index}`,
		});
	add({ id: "revisit-evicted-A", frame: 9, time: afterGap[2].time + 0.1 });
	for (let frame = 0; frame < 10; frame++)
		add({
			id: `replay-${frame}`,
			frame,
			clearBefore: frame === 0,
			repeatOf: `rolling-${frame}`,
			comparison: "temporal-diagnostic",
		});
	for (const [frame, tone] of JIANYING_PORTRAIT_SKIN_TONES.entries())
		add({
			id: `resource-${tone.resourceId}`,
			frame,
			sourceKey: "palette",
			adjustments: {
				enabled: true,
				skinToneResourceId: tone.resourceId,
				values: {
					face_adjust_skin_Intensity: 60,
					face_adjust_skin_ColdWarm: 25,
				},
			},
		});
	const tan: MediaPortraitAdjustments = {
		enabled: true,
		skinToneResourceId: JIANYING_PORTRAIT_SKIN_TONES[0].resourceId,
		values: { face_adjust_skin_Intensity: 60, face_adjust_skin_ColdWarm: 25 },
	};
	add({
		id: "resource-revisit",
		frame: 5,
		sourceKey: "palette",
		adjustments: tan,
	});
	add({
		id: "none-stale-warmth",
		frame: 6,
		sourceKey: "palette",
		adjustments: { ...tan, skinToneResourceId: null },
		comparison: "original",
	});
	add({ id: "after-none", frame: 7, sourceKey: "palette", adjustments: tan });
	add({
		id: "zero",
		frame: 8,
		sourceKey: "palette",
		adjustments: {
			...tan,
			values: { face_adjust_skin_Intensity: 0, face_adjust_skin_ColdWarm: 0 },
		},
		comparison: "original",
	});
	for (let frame = 0; frame < 6; frame++)
		add({
			id: `combined-${frame}`,
			frame,
			sourceKey: "combined",
			adjustments: SESSION_COMBINED_ADJUSTMENTS,
			comparison: frame === 0 ? "exact-reset" : "temporal-diagnostic",
		});
	add({
		id: "disabled",
		frame: 6,
		sourceKey: "combined",
		adjustments: { ...SESSION_COMBINED_ADJUSTMENTS, enabled: false },
		comparison: "original",
	});
	add({
		id: "after-disabled",
		frame: 7,
		sourceKey: "combined",
		adjustments: SESSION_COMBINED_ADJUSTMENTS,
	});
	add({
		id: "clear-reset",
		frame: 8,
		clearBefore: true,
		sourceKey: "combined",
		adjustments: SESSION_COMBINED_ADJUSTMENTS,
	});
	return steps;
}

export interface PortraitSessionSample {
	id: string;
	comparison: PortraitSessionStep["comparison"];
	baseline: PortraitSessionStep["baseline"];
	sourceKey: string;
	frame: number;
	time: number;
	adjustments: MediaPortraitAdjustments;
	activeGroups: JianyingPortraitAdjustmentRenderResult["activeGroups"];
	difference: ReturnType<typeof compareRgbaPixels>;
	effect: ReturnType<typeof compareRgbaPixels>;
	repeatDifference: ReturnType<typeof compareRgbaPixels> | null;
	violations: string[];
	passed: boolean;
}

export async function runPortraitSessionPlan({
	steps,
	frames,
	width,
	height,
	createProvider,
	onSample,
}: {
	steps: PortraitSessionStep[];
	frames: Uint8Array[];
	width: number;
	height: number;
	createProvider: () => PortraitSessionProvider;
	onSample: (args: {
		sample: PortraitSessionSample;
		actual: Uint8Array;
		expected: Uint8Array;
	}) => Promise<void>;
}) {
	if (
		frames.length !== 10 ||
		steps.length === 0 ||
		steps.length > 80 ||
		width * height > 2_100_000 ||
		frames.some((rgba) => rgba.byteLength !== width * height * 4)
	)
		throw new Error("Invalid bounded session input");
	const provider = createProvider();
	const saved = new Map<string, Uint8Array>();
	const samples: PortraitSessionSample[] = [];
	const request = ({
		step,
		frame = step.frame,
		time = step.time,
		sourceKey = step.sourceKey,
	}: {
		step: PortraitSessionStep;
		frame?: number;
		time?: number;
		sourceKey?: string;
	}): JianyingPortraitAdjustmentRenderRequest => ({
		width,
		height,
		rgba: frames[frame],
		frameNumber: frame,
		timestampSeconds: time,
		sourceKey,
		adjustments: step.adjustments,
	});
	const metrics = ({
		actual,
		expected,
	}: {
		actual: Uint8Array;
		expected: Uint8Array;
	}) => compareRgbaPixels({ actual, expected, width, height });
	try {
		await steps.reduce(async (previous, step) => {
			await previous;
			if (step.clearBefore) await provider.clear();
			const result = await provider.render(request({ step }));
			if (result.width !== width || result.height !== height)
				throw new Error("Provider changed frame dimensions");
			let expected = frames[step.frame];
			if (step.comparison !== "original") {
				const isolated = createProvider();
				try {
					await step.baseline.reduce(async (prior, frame) => {
						await prior;
						expected = (
							await isolated.render(
								request({ step, ...frame, sourceKey: `isolated:${step.id}` })
							)
						).rgba;
					}, Promise.resolve());
				} finally {
					await isolated.clear();
				}
			}
			const difference = metrics({ actual: result.rgba, expected });
			const effect = metrics({
				actual: result.rgba,
				expected: frames[step.frame],
			});
			const repeat = step.repeatOf ? saved.get(step.repeatOf) : undefined;
			if (step.repeatOf && !repeat)
				throw new Error(`Missing repeat oracle: ${step.repeatOf}`);
			const repeatDifference = repeat
				? metrics({ actual: result.rgba, expected: repeat })
				: null;
			const violations: string[] = [];
			if (
				step.comparison !== "temporal-diagnostic" &&
				difference.changedPixels > 0
			)
				violations.push("baseline-mismatch");
			if (repeatDifference && repeatDifference.changedPixels > 0)
				violations.push("repeat-mismatch");
			if (step.comparison !== "original" && effect.changedPixels === 0)
				violations.push("effect-no-op");
			if (
				result.rgba.some(
					(value, index) =>
						index % 4 === 3 && value !== frames[step.frame][index]
				)
			)
				violations.push("alpha-changed");
			const sample: PortraitSessionSample = {
				id: step.id,
				comparison: step.comparison,
				baseline: step.baseline,
				sourceKey: step.sourceKey,
				frame: step.frame,
				time: step.time,
				adjustments: step.adjustments,
				activeGroups: result.activeGroups,
				difference,
				effect,
				repeatDifference,
				violations,
				passed: violations.length === 0,
			};
			saved.set(step.id, new Uint8Array(result.rgba));
			samples.push(sample);
			await onSample({ sample, actual: result.rgba, expected });
		}, Promise.resolve());
		return samples;
	} finally {
		await provider.clear();
	}
}
