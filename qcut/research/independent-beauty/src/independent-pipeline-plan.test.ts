import { describe, expect, test } from "bun:test";
import { independentPipelineAdjustments, independentPipelineCatalog, independentPipelinePlan } from "./independent-pipeline-plan.js";

describe("independent composite plan", () => {
	test("groups face and GAN controls while recalculating later makeup from new pixels", () => {
		const result = independentPipelinePlan({ value: { values: { Chin: -15, TotalFace: 30, Whiten: 20,
			yunfu: 25, fuling: 15, lunkuopinghua: 10, upper_atrium: 12 },
			makeup: { lip: { cardId: "lip-soft-pink", intensity: 60 }, blush: { cardId: "blush-baby-pink", intensity: 40 } } } });
		expect(result.stages.map(({ id }) => id)).toEqual(["whiten", "skin-gan", "local-upper_atrium", "face-features",
			"makeup:lip-soft-pink", "makeup:blush-baby-pink"]);
		expect(result.stages[1].parameters).toEqual(["--yunfu", "25", "--fuling", "15", "--contour", "10"]);
		expect(result.stages[3].parameters).toEqual(["--controls", '{"TotalFace":30,"Chin":-15}']);
		expect(result.stages[4].parameters).toEqual(["--card", "lip-soft-pink", "--strength", "0.6"]);
	});
	test("face and feature controls share one inference and one renderer", () => {
		const controls = { TotalFace: 25, CutFace: -10, EnlargeEye: 35, EyeSpacing: -15, MoveEye: 10, ZoomMouth: -20 };
		const plan = independentPipelinePlan({ value: { values: controls } });
		expect(plan.stages).toEqual([{ id: "face-features", kind: "controls", script: "face_features_render.py",
			parameters: ["--controls", JSON.stringify(controls)], controls }]);
		for (const values of [{ TotalFace: 25 }, { EnlargeEye: 35 }, { TotalFace: 0, Nose: 20 }]) {
			expect(independentPipelinePlan({ value: { values } }).stages[0].script).toBe("face_features_render.py");
		}
	});
	test("empty or zero controls generate identity plans", () => {
		expect(independentPipelinePlan({ value: {} }).stages).toEqual([]);
		expect(independentPipelinePlan({ value: { values: { TotalFace: 0, Whiten: -0 },
			makeup: { lip: { cardId: "lip-soft-pink", intensity: 0 } } } }).stages).toEqual([]);
	});
	test("aliases and insertion order produce the same plan", () => {
		const a = independentPipelinePlan({ value: { values: { Chin: -8, face_adjust_TotalFace: 10, Smooth: 30 } } });
		const b = independentPipelinePlan({ value: { values: { TotalFace: 10, Smooth: 30, Chin: -8 } } });
		expect(a).toEqual(b);
		expect(() => independentPipelineAdjustments({ value: { values: { TotalFace: 0, face_adjust_TotalFace: 10 } } })).toThrow("重复");
	});
	test("rejects unsupported controls, untrusted inputs, nonnumeric strengths and wrong card categories", () => {
		for (const value of [null, [], { values: null }, { values: [] }, { values: { TotalFace: "30" } },
			{ values: { TotalFace: NaN } }, { values: { Chin: -51 } }, { values: { TotalFace: true } },
			{ values: { nativePixels: 1 } }, { nativeInputs: true }, { values: { body_adjust_Waist: 1 } },
			{ makeup: { lip: { cardId: "brows-wild", intensity: 30 } } },
			{ makeup: { lip: { cardId: "lip-soft-pink", intensity: 101 } } },
			{ makeup: { lip: { cardId: "lip-soft-pink", intensity: 30, nativePixels: [] } } }]) {
			expect(() => independentPipelinePlan({ value })).toThrow();
		}
	});
	test("all catalogue values dispatch to supported owned stages", () => {
		const catalog = independentPipelineCatalog();
		for (const control of catalog.controls) {
			const plan = independentPipelinePlan({ value: { values: { [control.name]: control.max } } });
			expect(plan.stages.length).toBe(1);
			expect(plan.stages[0].script.endsWith("_render.py")).toBeTrue();
		}
		for (const card of catalog.makeup) {
			const plan = independentPipelinePlan({ value: { makeup: { [card.category]: { cardId: card.id, intensity: 25 } } } });
			expect(plan.stages.length).toBe(1);
			expect(plan.stages[0].id).toBe(`makeup:${card.id}`);
		}
	});
});
