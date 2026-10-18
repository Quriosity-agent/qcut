import { describe, expect, test } from "bun:test";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../electron/jianying-portrait-adjustment-runtime/catalog.js";
import {
	independentPipelineCatalog,
	independentPipelinePlan,
} from "./independent-pipeline-plan.js";

const bodyControls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
	({ group }) => group === "body"
);
const bodyValues = Object.fromEntries(
	bodyControls.map(({ key, min, max }) => [key, min < 0 ? min : max])
);

describe("independent smart body plan", () => {
	test("covers the ten editor controls with the same ranges", () => {
		const controls = independentPipelineCatalog().controls.filter(
			({ group }) => group === "body"
		);
		expect(controls).toHaveLength(10);
		expect(controls.map(({ name, min, max }) => ({ name, min, max }))).toEqual(
			bodyControls.map(({ key, min, max }) => ({
				name: key.slice("body_adjust_".length),
				min,
				max,
			}))
		);
	});

	test.each(bodyControls)("validates $key endpoints and its prefix", ({
		key,
		min,
		max,
	}) => {
		const name = key.slice("body_adjust_".length);
		for (const value of [min, max]) {
			const plan = independentPipelinePlan({
				value: { values: { [key]: value } },
			});
			expect(plan.adjustments.values).toEqual({ [name]: value });
			expect(plan.stages).toHaveLength(value === 0 ? 0 : 1);
		}
		for (const value of [min - 0.01, max + 0.01, NaN, Infinity])
			expect(() =>
				independentPipelinePlan({ value: { values: { [key]: value } } })
			).toThrow();
		expect(() =>
			independentPipelinePlan({
				value: { values: { [`face_adjust_${name}`]: max } },
			})
		).toThrow();
	});

	test("combines all ten controls once after manual body, face shaping and makeup", () => {
		const plan = independentPipelinePlan({
			value: {
				values: { ...bodyValues, face_adjust_TotalFace: 20 },
				manualBody: { stretch: { intensity: 10, upper: 0.8, bottom: 0.2 } },
				makeup: { lip: { cardId: "lip-soft-pink", intensity: 25 } },
			},
		});
		expect(plan.stages.map(({ id }) => id)).toEqual([
			"manual-body",
			"face-features",
			"makeup:lip-soft-pink",
			"smart-body",
		]);
		const controls = Object.fromEntries(
			Object.entries(bodyValues).map(([key, value]) => [
				key.slice("body_adjust_".length),
				value,
			])
		);
		expect(plan.stages.at(-1)).toEqual({
			id: "smart-body",
			kind: "controls",
			script: "body_smart_render.py",
			parameters: ["--controls", JSON.stringify(controls)],
			controls,
		});
		expect(controls).toMatchObject({
			WidenShoulderTest: -50,
			SlimBreast: -50,
			SlimHip: -50,
		});
	});

	test("keeps the same composite when controls are reordered and no stage when all are zero", () => {
		const plan = independentPipelinePlan({ value: { values: bodyValues } });
		expect(
			independentPipelinePlan({
				value: {
					values: Object.fromEntries(Object.entries(bodyValues).reverse()),
				},
			})
		).toEqual(plan);
		expect(
			independentPipelinePlan({
				value: {
					values: Object.fromEntries(bodyControls.map(({ key }) => [key, 0])),
				},
			}).stages
		).toEqual([]);
	});
});
