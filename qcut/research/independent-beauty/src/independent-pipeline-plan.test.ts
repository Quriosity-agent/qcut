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
	test("smart body runs last, after makeup, and takes only the body prefix", () => {
		const plan = independentPipelinePlan({
			value: {
				values: {
					body_adjust_SlimHip: -20,
					body_adjust_StretchLeg: 60,
					face_adjust_Whiten: 20,
				},
				makeup: { lip: { cardId: "lip-soft-pink", intensity: 30 } },
			},
		});
		expect(plan.stages.map(({ id }) => id)).toEqual([
			"whiten",
			"makeup:lip-soft-pink",
			"smart-body",
		]);
		expect(plan.stages.at(-1)).toEqual({
			id: "smart-body",
			kind: "controls",
			script: "body_smart_render.py",
			parameters: [
				"--controls",
				JSON.stringify({ StretchLeg: 60, SlimHip: -20 }),
			],
			controls: { StretchLeg: 60, SlimHip: -20 },
		});
		expect(plan.adjustments.values).toEqual({
			Whiten: 20,
			StretchLeg: 60,
			SlimHip: -20,
		});
		// A shared makeup pass also comes before it.
		const grouped = independentPipelinePlan({
			value: {
				values: { body_adjust_StretchLeg: 40 },
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 30 },
					brows: { cardId: "brows-standard", intensity: 30 },
				},
			},
		});
		expect(grouped.stages.map(({ id }) => id)).toEqual([
			"dynamic-pigments",
			"smart-body",
		]);
		for (const values of [
			{ face_adjust_StretchLeg: 10 },
			{ body_adjust_Whiten: 10 },
			{ body_adjust_SlimWaist: 101 },
			{ body_adjust_SlimHip: -51 },
			{ body_adjust_StretchLeg: 100.5 },
		])
			expect(() => independentPipelinePlan({ value: { values } })).toThrow();
		const body = independentPipelineCatalog().controls.filter(
			({ group }) => group === "body"
		);
		expect(body.map(({ name }) => name)).toEqual([
			"SmallHead",
			"SwanNeck",
			"SlimArm",
			"OrthoShoulder",
			"WidenShoulderTest",
			"SlimBody",
			"SlimWaist",
			"StretchLeg",
			"SlimBreast",
			"SlimHip",
		]);
		expect(body.find(({ name }) => name === "SlimHip")).toEqual({
			name: "SlimHip",
			title: "美胯",
			min: -50,
			max: 50,
			group: "body",
		});
	});
	test("manual body stretch runs after the skin stages and before face shaping", () => {
		const stretch = { intensity: -30, upper: 0.72, bottom: 0.18 };
		const plan = independentPipelinePlan({
			value: {
				values: { Whiten: 20, TotalFace: 30 },
				manualBody: { stretch },
			},
		});
		expect(plan.stages.map(({ id }) => id)).toEqual([
			"whiten",
			"manual-body",
			"face-features",
		]);
		expect(plan.stages[1]).toEqual({
			id: "manual-body",
			kind: "manual-body",
			script: "manual_body_render.py",
			parameters: ["--manual-body", JSON.stringify({ stretch })],
			controls: { stretch },
		});
		expect(plan.adjustments.manualBody).toEqual({ stretch });
		expect(independentPipelineCatalog().manualBodyTools).toEqual([
			"stretch",
			"slim",
			"zoom",
		]);
	});
	test("slim and zoom join the stretch in one manual-body stage; idle tools are dropped", () => {
		const slim = {
			intensity: 25,
			x: 0.5,
			y: 0.42,
			width: 0.3,
			height: 0.35,
			rotation: -30,
		};
		const zoom = { intensity: -15, x: 0.48, y: 0.64, radius: 0.12 };
		const plan = independentPipelinePlan({
			value: {
				manualBody: {
					stretch: { intensity: 0, upper: 0.6, bottom: 0.4 },
					slim,
					zoom,
				},
			},
		});
		expect(plan.adjustments.manualBody).toEqual({ slim, zoom });
		expect(plan.stages).toEqual([
			{
				id: "manual-body",
				kind: "manual-body",
				script: "manual_body_render.py",
				parameters: ["--manual-body", JSON.stringify({ slim, zoom })],
				controls: { slim, zoom },
			},
		]);
		const idle = independentPipelinePlan({
			value: { manualBody: { zoom: { ...zoom, intensity: 0 } } },
		});
		expect(idle.adjustments).toEqual({ values: {}, makeup: {} });
		expect(idle.stages).toEqual([]);
	});
	test("an idle stretch leaves no stage and no manual body in the plan", () => {
		const plan = independentPipelinePlan({
			value: {
				manualBody: { stretch: { intensity: 0, upper: 0.6, bottom: 0.4 } },
			},
		});
		expect(plan.stages).toEqual([]);
		expect(plan.adjustments).toEqual({ values: {}, makeup: {} });
	});
	test("rejects manual body tools and settings outside the editor's ranges", () => {
		const stretch = { intensity: 20, upper: 0.7, bottom: 0.2 };
		const slim = {
			intensity: 10,
			x: 0.5,
			y: 0.5,
			width: 0.2,
			height: 0.2,
			rotation: 0,
		};
		const zoom = { intensity: 10, x: 0.5, y: 0.5, radius: 0.2 };
		for (const manualBody of [
			{ twist: slim },
			{ slim: { ...slim, rotation: 181 } },
			{ slim: { ...slim, width: 0.01 } },
			{ slim: { ...slim, y: -0.1 } },
			{ slim: { ...slim, radius: 0.2 } },
			{ zoom: { ...zoom, radius: 0.51 } },
			{ zoom: { ...zoom, radius: 0.005 } },
			{ zoom: { x: 0.5, y: 0.5, radius: 0.2 } },
			{ zoom: { ...zoom, intensity: -51 } },
			{ stretch: { ...stretch, intensity: 51 } },
			{ stretch: { ...stretch, upper: 0.21 } },
			{ stretch: { ...stretch, bottom: 0.99 } },
			{ stretch: { ...stretch, extra: 1 } },
			{ stretch: { intensity: 20, upper: 0.7 } },
			{ stretch: { ...stretch, intensity: Number.NaN } },
			[],
		]) {
			expect(() =>
				independentPipelinePlan({ value: { manualBody } })
			).toThrow();
		}
	});
});
