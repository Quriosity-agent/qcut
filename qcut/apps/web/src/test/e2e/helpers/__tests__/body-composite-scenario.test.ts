// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { parseJianyingPortraitRenderRequest } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/request";
import { buildJianyingPortraitRenderStages } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/stages";
import { createBodyCompositeScenario } from "../body-composite-scenario";

vi.mock("../electron-helpers", () => ({}));

afterEach(() => vi.unstubAllEnvs());

describe("body composite evidence scenario", () => {
	it("preserves the facial fixture defaults and composite adjustments", async () => {
		for (const key of [
			"QCUT_PORTRAIT_COMPOSITE_SECONDS",
			"QCUT_PORTRAIT_COMPOSITE_SAMPLES",
			"QCUT_PORTRAIT_COMPOSITE_FIT",
		])
			vi.stubEnv(key, undefined);
		const { COMPOSITE_SETTINGS, portraitCompositeAdjustments } = await import(
			"../portrait-composite-project"
		);
		expect(COMPOSITE_SETTINGS).toEqual({
			width: 1080,
			height: 1920,
			fps: 30,
			seconds: 12,
			totalFrames: 360,
			transitionSeconds: 1,
			fit: "cover",
			samples: [0, 30, 90, 165, 180, 194, 270, 359],
		});
		expect(portraitCompositeAdjustments({ pass: "original" })).toEqual({
			enabled: false,
			values: {},
		});
		for (const engine of ["native", "independent"] as const)
			expect(portraitCompositeAdjustments({ pass: engine })).toEqual({
				enabled: true,
				engine,
				faceTarget: { mode: "all" },
				values: { face_adjust_TotalFace: 25, face_adjust_EnlargeEye: 20 },
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 35 } },
			});
	});

	it("passes strict geometry validation and constructs the intended native stages", () => {
		const packages = JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map(
			(runtimePackage) => ({
				runtimePackage,
				group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
				packagePath: `/private/${runtimePackage}`,
				source: "qcut-private" as const,
			})
		);
		const plans = createBodyCompositeScenario().passes.map(
			({ id, adjustments }) => {
				const request = parseJianyingPortraitRenderRequest({
					request: {
						width: 2,
						height: 1,
						rgba: new Uint8Array(8),
						adjustments,
					},
				});
				expect(request.adjustments.enabled).toBe(adjustments.enabled);
				expect(request.adjustments.values).toEqual(adjustments.values);
				expect(request.adjustments.manualBody).toEqual(adjustments.manualBody);
				return {
					id,
					stages: buildJianyingPortraitRenderStages({
						request,
						packages,
						makeupCards: [],
					}),
				};
			}
		);
		const manualStages = [
			"manual-body:stretch",
			"manual-body:slim",
			"manual-body:zoom",
		];
		expect(
			plans.map(({ id, stages }) => ({
				id,
				stages: stages.map((stage) => stage.id),
			}))
		).toEqual([
			{ id: "original", stages: [] },
			{ id: "smart", stages: ["package:body"] },
			{ id: "manual", stages: manualStages },
			{ id: "combined", stages: [...manualStages, "package:body"] },
		]);
		expect(
			plans[2].stages.map(({ featureParameters }) =>
				JSON.parse(featureParameters)
			)
		).toEqual([
			{ effects_adjust_intensity: 0.2, upper: 0.8, bottom: 0.2 },
			{
				effects_adjust_intensity: 0.25,
				x: 0.5,
				y: 0.55,
				width: 0.5,
				height: 0.65,
				rotation: 0,
			},
			{ effects_adjust_intensity: 0.15, x: 0.5, y: 0.4, r: 0.18 },
		]);
	});

	it("covers all body stages with 180 frames and reverse transition seeks", () => {
		const scenario = createBodyCompositeScenario();
		expect(scenario.settings).toMatchObject({
			width: 1080,
			height: 1920,
			fps: 30,
			seconds: 6,
			totalFrames: 180,
			transitionSeconds: 1,
			samples: [0, 15, 45, 75, 90, 105, 135, 179],
		});
		expect(scenario.previewIndices).toEqual([0, 179, 135, 105, 90, 75, 45, 15]);
		expect(scenario.passes.map(({ id }) => id)).toEqual([
			"original",
			"smart",
			"manual",
			"combined",
		]);
		const [original, smart, manual, combined] = scenario.passes;
		expect(original.adjustments).toEqual({ enabled: false, values: {} });
		expect(Object.keys(smart.adjustments.values)).toEqual([
			"body_adjust_SlimBody",
			"body_adjust_SlimWaist",
			"body_adjust_StretchLeg",
		]);
		expect(smart.adjustments.manualBody).toBeUndefined();
		expect(manual.adjustments.values).toEqual({});
		expect(Object.keys(manual.adjustments.manualBody ?? {})).toEqual([
			"stretch",
			"slim",
			"zoom",
		]);
		expect(combined.adjustments).toEqual({
			...smart.adjustments,
			manualBody: manual.adjustments.manualBody,
		});
	});

	it("allows a two-second smart/manual smoke without changing the HD dimensions", () => {
		const scenario = createBodyCompositeScenario({
			seconds: 2,
			samples: [59, 30, 15, 0, 15],
			passes: ["smart", "manual", "smart"],
		});
		expect(scenario.settings).toMatchObject({
			width: 1080,
			height: 1920,
			totalFrames: 60,
			samples: [0, 15, 30, 59],
		});
		expect(scenario.passes.map(({ id }) => id)).toEqual(["smart", "manual"]);
		expect(scenario.previewIndices).toEqual([0, 59, 30, 15]);
	});

	it.each(
		[0, -1, Number.NaN, Number.POSITIVE_INFINITY, 61, 1.01, 0.5].map(
			(seconds) => ({ seconds })
		)
	)("rejects invalid or uneven split durations: $seconds", ({ seconds }) => {
		expect(() => createBodyCompositeScenario({ seconds })).toThrow(
			"Invalid body composite duration"
		);
	});

	it.each(
		[
			[],
			[0, 1, 2],
			[-1, 0, 1, 2],
			[0, 1, 2, 180],
			[0, 1, 2, Number.NaN],
			[0, 1, 2, 2.5],
		].map((samples) => ({ samples }))
	)("rejects incomplete or invalid sample indices: $samples", ({ samples }) => {
		expect(() => createBodyCompositeScenario({ samples })).toThrow(
			"Invalid body composite sample frame indices"
		);
	});

	it("rejects unknown or empty pass selections", () => {
		expect(() => createBodyCompositeScenario({ passes: [] })).toThrow();
		expect(() => createBodyCompositeScenario({ passes: ["native"] })).toThrow();
	});
});
