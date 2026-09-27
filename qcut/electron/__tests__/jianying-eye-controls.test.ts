// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	jianyingPortraitRuntimePackageForControl,
} from "../jianying-portrait-adjustment-runtime/catalog.js";

const eyes = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
	({ category }) => category === "eyes"
);

describe("canonical eye controls", () => {
	it("uses the six observed controls in UI order without duplicating keys", () => {
		expect(eyes.map(({ titleZh }) => titleZh)).toEqual([
			"大眼",
			"亮眼",
			"眼距",
			"开眼角",
			"眼高低",
			"眼倾斜",
		]);
		expect(
			new Set(JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.map(({ key }) => key)).size
		).toBe(JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.length);
	});
	it.each(eyes)("normalizes $key once at both endpoints", (control) => {
		for (const value of [control.min, control.max]) {
			const params = JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage: jianyingPortraitRuntimePackageForControl({ control }),
					values: { [control.key]: value },
				})
			);
			expect(params[control.key]).toEqual([{ id: -1, intensity: value / 100 }]);
		}
	});
	it("keeps bright eye independent from eye bags and nasolabial folds", () => {
		const params = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "eye-details",
				values: { face_adjust_BrightEye: 75 },
			})
		);
		expect(params.face_adjust_BrightEye).toEqual([{ id: -1, intensity: 0.75 }]);
		expect(params.face_adjust_Pouch).toEqual([{ id: -1, intensity: 0 }]);
		expect(params.face_adjust_NasolabialFolds).toEqual([
			{ id: -1, intensity: 0 },
		]);
	});
	it("retains legacy detailed-eye routes and signed values", () => {
		const params = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "features",
				values: { face_adjust_eye: 20, face_adjust_eye_position: -10 },
			})
		);
		expect(params.face_adjust_eye).toEqual([{ id: -1, intensity: 0.2 }]);
		expect(params.face_adjust_eye_position).toEqual([
			{ id: -1, intensity: -0.1 },
		]);
		for (const key of [
			"face_adjust_eye",
			"face_adjust_eye_position",
			"face_adjust_CornerEye",
		]) {
			expect(
				JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
					(control) => control.key === key
				)?.category
			).toBe("details");
		}
	});
});
