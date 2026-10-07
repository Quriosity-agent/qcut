import { describe, expect, test } from "bun:test";
import {
	independentPipelineAdjustments,
	independentPipelineCatalog,
	independentPipelinePlan,
} from "./independent-pipeline-plan.js";

describe("independent composite plan", () => {
	test("groups face and GAN controls while recalculating later makeup from new pixels", () => {
		const result = independentPipelinePlan({
			value: {
				values: {
					Chin: -15,
					TotalFace: 30,
					Whiten: 20,
					yunfu: 25,
					fuling: 15,
					lunkuopinghua: 10,
					upper_atrium: 12,
				},
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 60 },
					blush: { cardId: "blush-baby-pink", intensity: 40 },
				},
			},
		});
		expect(result.stages.map(({ id }) => id)).toEqual([
			"whiten",
			"skin-gan",
			"face-features",
			"dynamic-pigments",
		]);
		expect(result.stages[1].parameters).toEqual([
			"--yunfu",
			"25",
			"--fuling",
			"15",
			"--contour",
			"10",
		]);
		expect(result.stages[2].parameters).toEqual([
			"--controls",
			'{"TotalFace":30,"Chin":-15,"upper_atrium":12}',
		]);
		expect(result.stages[3].parameters).toEqual([
			"--selections",
			JSON.stringify(result.adjustments.makeup),
		]);
	});
	test("supported dynamic pigments share one stage regardless of request order", () => {
		const makeup = {
			lip: { cardId: "lip-soft-pink", intensity: 60 },
			brows: { cardId: "brows-standard", intensity: 40 },
			blush: { cardId: "blush-baby-pink", intensity: 50 },
		};
		const plan = independentPipelinePlan({ value: { makeup } });
		expect(plan.stages).toEqual([
			{
				id: "dynamic-pigments",
				kind: "makeup-group",
				script: "dynamic_makeup_render.py",
				parameters: ["--selections", JSON.stringify(plan.adjustments.makeup)],
				controls: plan.adjustments.makeup,
			},
		]);
		expect(
			independentPipelinePlan({
				value: { makeup: Object.fromEntries(Object.entries(makeup).reverse()) },
			})
		).toEqual(plan);
		const zeroBlush = independentPipelinePlan({
			value: {
				makeup: { ...makeup, blush: { ...makeup.blush, intensity: 0 } },
			},
		});
		expect(zeroBlush.stages[0].controls).toEqual({
			lip: makeup.lip,
			brows: makeup.brows,
		});
	});
	test("a card outside the verified shared group retains its existing renderer", () => {
		const plan = independentPipelinePlan({
			value: {
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 60 },
					brows: { cardId: "brows-standard", intensity: 40 },
					highlight: { cardId: "highlight-sweetheart", intensity: 20 },
				},
			},
		});
		expect(plan.stages.every(({ kind }) => kind === "makeup")).toBeTrue();
	});
	test("contour shares one pigment stage with blush brows and lip", () => {
		const makeup = {
			lip: { cardId: "lip-soft-pink", intensity: 60 },
			brows: { cardId: "brows-standard", intensity: 40 },
			blush: { cardId: "blush-baby-pink", intensity: 50 },
			contour: { cardId: "contour-mixed", intensity: 50 },
		};
		const plan = independentPipelinePlan({ value: { makeup } });
		expect(plan.stages.length).toBe(1);
		expect(plan.stages[0].id).toBe("dynamic-pigments");
		expect(plan.stages[0].controls).toEqual(plan.adjustments.makeup);
		expect(
			independentPipelinePlan({
				value: { makeup: Object.fromEntries(Object.entries(makeup).reverse()) },
			})
		).toEqual(plan);
	});
	test("eye layers join the same pigment stage without extra requests", () => {
		const makeup = {
			eyeliner: { cardId: "eyeliner-cat", intensity: 60 },
			aegyo: { cardId: "aegyo-natural", intensity: 55 },
			eyeshadow: { cardId: "eyeshadow-girl-pink", intensity: 45 },
			contour: { cardId: "contour-mixed", intensity: 50 },
			lip: { cardId: "lip-soft-pink", intensity: 60 },
		};
		const plan = independentPipelinePlan({ value: { makeup } });
		expect(plan.stages.length).toBe(1);
		expect(plan.stages[0].id).toBe("dynamic-pigments");
		expect(plan.stages[0].controls).toEqual(plan.adjustments.makeup);
	});
	test("face and feature controls share one inference and one renderer", () => {
		const controls = {
			TotalFace: 25,
			CutFace: -10,
			EnlargeEye: 35,
			EyeSpacing: -15,
			MoveEye: 10,
			ZoomMouth: -20,
		};
		const plan = independentPipelinePlan({ value: { values: controls } });
		expect(plan.stages).toEqual([
			{
				id: "face-features",
				kind: "controls",
				script: "portrait_features_render.py",
				parameters: ["--controls", JSON.stringify(controls)],
				controls,
			},
		]);
		for (const values of [
			{ TotalFace: 25 },
			{ EnlargeEye: 35 },
			{ TotalFace: 0, Nose: 20 },
		]) {
			expect(
				independentPipelinePlan({ value: { values } }).stages[0].script
			).toBe("portrait_features_render.py");
		}
	});
	test("local controls share a package-aware renderer with common face controls", () => {
		const values = {
			underjaw: 25,
			lower_atrium: -25,
			TotalFace: 25,
			EnlargeEye: 35,
			EyeSpacing: -15,
		};
		const plan = independentPipelinePlan({ value: { values } });
		expect(plan.stages).toEqual([
			{
				id: "face-features",
				kind: "controls",
				script: "portrait_features_render.py",
				parameters: [
					"--controls",
					'{"TotalFace":25,"EnlargeEye":35,"EyeSpacing":-15,"underjaw":25,"lower_atrium":-25}',
				],
				controls: {
					TotalFace: 25,
					EnlargeEye: 35,
					EyeSpacing: -15,
					underjaw: 25,
					lower_atrium: -25,
				},
			},
		]);
		expect(
			independentPipelinePlan({
				value: { values: Object.fromEntries(Object.entries(values).reverse()) },
			})
		).toEqual(plan);
		const localOnly = independentPipelinePlan({
			value: { values: { underjaw: 25, mid_atrium: -20 } },
		});
		expect(localOnly.stages.length).toBe(1);
		expect(localOnly.stages[0].controls).toEqual({
			underjaw: 25,
			mid_atrium: -20,
		});
	});
	test("empty or zero controls generate identity plans", () => {
		expect(independentPipelinePlan({ value: {} }).stages).toEqual([]);
		expect(
			independentPipelinePlan({
				value: {
					values: { TotalFace: 0, Whiten: -0 },
					makeup: { lip: { cardId: "lip-soft-pink", intensity: 0 } },
				},
			}).stages
		).toEqual([]);
	});
	test("aliases and insertion order produce the same plan", () => {
		const a = independentPipelinePlan({
			value: { values: { Chin: -8, face_adjust_TotalFace: 10, Smooth: 30 } },
		});
		const b = independentPipelinePlan({
			value: { values: { TotalFace: 10, Smooth: 30, Chin: -8 } },
		});
		expect(a).toEqual(b);
		expect(() =>
			independentPipelineAdjustments({
				value: { values: { TotalFace: 0, face_adjust_TotalFace: 10 } },
			})
		).toThrow("重复");
	});
	test("rejects unsupported controls, untrusted inputs, nonnumeric strengths and wrong card categories", () => {
		for (const value of [
			null,
			[],
			{ values: null },
			{ values: [] },
			{ values: { TotalFace: "30" } },
			{ values: { TotalFace: NaN } },
			{ values: { Chin: -51 } },
			{ values: { TotalFace: true } },
			{ values: { nativePixels: 1 } },
			{ nativeInputs: true },
			{ values: { body_adjust_Waist: 1 } },
			{ makeup: { lip: { cardId: "brows-wild", intensity: 30 } } },
			{ makeup: { lip: { cardId: "lip-soft-pink", intensity: 101 } } },
			{
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 30, nativePixels: [] },
				},
			},
		]) {
			expect(() => independentPipelinePlan({ value })).toThrow();
		}
	});
	test("all catalogue values dispatch to supported owned stages", () => {
		const catalog = independentPipelineCatalog();
		for (const control of catalog.controls) {
			const plan = independentPipelinePlan({
				value: { values: { [control.name]: control.max } },
			});
			expect(plan.stages.length).toBe(1);
			expect(plan.stages[0].script.endsWith("_render.py")).toBeTrue();
		}
		for (const card of catalog.makeup) {
			const plan = independentPipelinePlan({
				value: {
					makeup: { [card.category]: { cardId: card.id, intensity: 25 } },
				},
			});
			expect(plan.stages.length).toBe(1);
			expect(plan.stages[0].id).toBe(`makeup:${card.id}`);
		}
	});
});
