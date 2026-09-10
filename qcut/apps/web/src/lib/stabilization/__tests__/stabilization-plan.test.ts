import { describe, expect, it } from "vitest";
import {
	buildStabilizationPlan,
	lookupStabilizedFrame,
	stabilizedFrameMatrix,
} from "../stabilization-plan";
import {
	type FrameMotion,
	type MotionAnalysis,
	STABILIZATION_ANALYSIS_VERSION,
} from "../stabilization-protocol";

const FPS = 30;

function analysisFrom({
	motions,
	analysisWidth = 640,
	sourceWidth = 640,
	sourceHeight = 360,
}: {
	motions: Array<Partial<FrameMotion>>;
	analysisWidth?: number;
	sourceWidth?: number;
	sourceHeight?: number;
}): MotionAnalysis {
	return {
		version: STABILIZATION_ANALYSIS_VERSION,
		contentSha256: "test",
		sourceWidth,
		sourceHeight,
		analysisWidth,
		analysisHeight: Math.round((analysisWidth * sourceHeight) / sourceWidth),
		frames: motions.map((motion, index) => ({
			ptsUs: Math.round((index * 1_000_000) / FPS),
			dx: 0,
			dy: 0,
			rotation: 0,
			scale: 1,
			tracked: 100,
			inliers: 80,
			...motion,
		})),
	};
}

/** Maps the four output corners back into the source and returns the worst overshoot. */
function windowOvershoot({
	matrix,
	width,
	height,
}: {
	matrix: [number, number, number, number, number, number];
	width: number;
	height: number;
}): number {
	const [a, b, c, d, e, f] = matrix;
	const determinant = a * d - b * c;
	const inverse = (x: number, y: number) => ({
		x: (d * (x - e) - c * (y - f)) / determinant,
		y: (-b * (x - e) + a * (y - f)) / determinant,
	});
	let overshoot = 0;
	for (const [x, y] of [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	]) {
		const point = inverse(x, y);
		overshoot = Math.max(
			overshoot,
			-point.x,
			-point.y,
			point.x - width,
			point.y - height
		);
	}
	return overshoot;
}

describe("buildStabilizationPlan", () => {
	it("keeps a static clip untouched apart from the crop zoom", () => {
		const plan = buildStabilizationPlan({
			analysis: analysisFrom({ motions: new Array(20).fill({}) }),
			profile: { smoothingSeconds: 1, cropScale: 0.9 },
		});
		expect(plan.frames).toHaveLength(20);
		for (const frame of plan.frames) {
			expect(frame.translationX).toBeCloseTo(0, 6);
			expect(frame.translationY).toBeCloseTo(0, 6);
			expect(frame.rotation).toBeCloseTo(0, 9);
			expect(frame.scale).toBeCloseTo(1, 6);
		}
		const matrix = stabilizedFrameMatrix({
			frame: plan.frames[0],
			cropScale: plan.cropScale,
			width: 640,
			height: 360,
		});
		expect(matrix[0]).toBeCloseTo(1 / 0.9, 6);
		expect(matrix[4]).toBeCloseTo(320 - 320 / 0.9, 3);
	});

	it("cancels high-frequency jitter while following the smooth path", () => {
		const motions = Array.from({ length: 90 }, (_, index) => ({
			dx: index === 0 ? 0 : 3 * Math.sin(index * 2.1),
			dy: index === 0 ? 0 : 2 * Math.cos(index * 1.7),
		}));
		const analysis = analysisFrom({ motions });
		const plan = buildStabilizationPlan({
			analysis,
			profile: { smoothingSeconds: 0.5, cropScale: 0.9 },
		});
		let x = 0;
		const measured: number[] = [];
		const residual: number[] = [];
		for (const [index, motion] of analysis.frames.entries()) {
			x += motion.dx;
			measured.push(x);
			residual.push(x + plan.frames[index].translationX);
		}
		const jitter = (values: number[]) =>
			Math.sqrt(
				values
					.slice(1)
					.reduce(
						(sum, value, index) => sum + (value - values[index]) ** 2,
						0
					) /
					(values.length - 1)
			);
		expect(jitter(residual)).toBeLessThan(jitter(measured) * 0.3);
	});

	it("scales analysis-pixel motion up to source pixels", () => {
		const motions = Array.from({ length: 30 }, (_, index) => ({
			dx: index === 10 ? 4 : 0,
		}));
		const half = buildStabilizationPlan({
			analysis: analysisFrom({ motions, analysisWidth: 320 }),
			profile: { smoothingSeconds: 1, cropScale: 0.8 },
		});
		const full = buildStabilizationPlan({
			analysis: analysisFrom({ motions, analysisWidth: 640 }),
			profile: { smoothingSeconds: 1, cropScale: 0.8 },
		});
		expect(half.frames[10].translationX).toBeCloseTo(
			full.frames[10].translationX * 2,
			6
		);
	});

	it("never lets the sampling window leave the source frame", () => {
		const motions = Array.from({ length: 40 }, (_, index) => ({
			dx: index === 12 ? 180 : 0,
			dy: index === 12 ? -90 : 0,
			rotation: index === 25 ? 0.2 : 0,
		}));
		const plan = buildStabilizationPlan({
			analysis: analysisFrom({ motions }),
			profile: { smoothingSeconds: 1, cropScale: 0.9 },
		});
		for (const frame of plan.frames) {
			const overshoot = windowOvershoot({
				matrix: stabilizedFrameMatrix({
					frame,
					cropScale: plan.cropScale,
					width: 640,
					height: 360,
				}),
				width: 640,
				height: 360,
			});
			expect(overshoot).toBeLessThan(1.5);
		}
		// The jump was too large to absorb fully, so some frames were clipped.
		expect(plan.frames.some((frame) => Math.abs(frame.translationX) > 30)).toBe(
			true
		);
	});
});

describe("lookupStabilizedFrame", () => {
	const plan = buildStabilizationPlan({
		analysis: analysisFrom({ motions: new Array(10).fill({}) }),
		profile: { smoothingSeconds: 1, cropScale: 0.9 },
	});

	it("returns the nearest frame by source time", () => {
		expect(lookupStabilizedFrame({ plan, sourceTimeSeconds: 0.1 })?.ptsUs).toBe(
			100_000
		);
		expect(
			lookupStabilizedFrame({ plan, sourceTimeSeconds: 0.115 })?.ptsUs
		).toBe(100_000);
		expect(
			lookupStabilizedFrame({ plan, sourceTimeSeconds: 0.118 })?.ptsUs
		).toBe(133_333);
	});

	it("returns null far outside the analysed range", () => {
		expect(lookupStabilizedFrame({ plan, sourceTimeSeconds: 2 })).toBeNull();
		expect(lookupStabilizedFrame({ plan, sourceTimeSeconds: -1 })).toBeNull();
		expect(
			lookupStabilizedFrame({ plan, sourceTimeSeconds: Number.NaN })
		).toBeNull();
	});
});
