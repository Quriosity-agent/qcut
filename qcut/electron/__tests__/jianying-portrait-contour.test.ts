// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

const packages = JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map(
	(runtimePackage) => ({
		runtimePackage,
		group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
		packagePath: `/runtime/${runtimePackage}`,
		source: "qcut-private" as const,
	})
);

function stagesFor({ adjustments }: { adjustments: MediaPortraitAdjustments }) {
	return buildJianyingPortraitRenderStages({
		request: {
			width: 2,
			height: 1,
			rgba: new Uint8Array(8),
			adjustments,
		},
		packages,
		makeupCards: [],
	});
}

describe("GAN contour routing", () => {
	it("separates contour flow from the legacy temple deformation", () => {
		const contour = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
			({ titleZh }) => titleZh === "流畅脸"
		);
		expect(contour).toMatchObject({
			key: "face_adjust_lunkuopinghua",
			runtimePackage: "skin-gan",
			section: "face-shape",
			min: 0,
			max: 100,
		});
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_temple"
			)
		).toMatchObject({
			titleZh: "太阳穴（基础）",
			runtimePackage: "features",
			section: "features",
			category: "details",
		});
	});

	it("does not activate temples, even skin, or plump for contour-only input", () => {
		const stages = stagesFor({
			adjustments: { enabled: true, values: { face_adjust_lunkuopinghua: 50 } },
		});
		expect(stages.map(({ runtimePackage }) => runtimePackage)).toEqual([
			"skin-gan",
		]);
		expect(JSON.parse(stages[0].featureParameters)).toEqual({
			face_adjust_yunfu: [{ id: -1, intensity: 0 }],
			face_adjust_fuling: [{ id: -1, intensity: 0 }],
			face_adjust_lunkuopinghua: [{ id: -1, intensity: 0.5 }],
		});
	});

	it("keeps a legacy temple-only project on its original package", () => {
		const stages = stagesFor({
			adjustments: { enabled: true, values: { face_adjust_temple: 50 } },
		});
		expect(stages.map(({ runtimePackage }) => runtimePackage)).toEqual([
			"features",
		]);
		expect(JSON.parse(stages[0].featureParameters).face_adjust_temple).toEqual([
			{ id: -1, intensity: 0.5 },
		]);
	});

	it("keeps both packages independent when an old project adds GAN contour", () => {
		const stages = stagesFor({
			adjustments: {
				enabled: true,
				values: { face_adjust_temple: 35, face_adjust_lunkuopinghua: 50 },
			},
		});
		expect(stages.map(({ runtimePackage }) => runtimePackage)).toEqual([
			"skin-gan",
			"features",
		]);
		expect(
			JSON.parse(stages[0].featureParameters).face_adjust_lunkuopinghua
		).toEqual([{ id: -1, intensity: 0.5 }]);
		expect(JSON.parse(stages[1].featureParameters).face_adjust_temple).toEqual([
			{ id: -1, intensity: 0.35 },
		]);
	});

	it("emits all GAN values independently for the selected and additional faces", () => {
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage: "skin-gan",
					values: {
						face_adjust_yunfu: 20,
						face_adjust_fuling: 30,
						face_adjust_lunkuopinghua: 50,
						face_adjust_temple: 80,
					},
					targetFaceId: 2,
					faceEntries: [{ id: 4, values: { face_adjust_lunkuopinghua: 75 } }],
				})
			)
		).toEqual({
			face_adjust_yunfu: [
				{ id: 2, intensity: 0.2 },
				{ id: 4, intensity: 0 },
			],
			face_adjust_fuling: [
				{ id: 2, intensity: 0.3 },
				{ id: 4, intensity: 0 },
			],
			face_adjust_lunkuopinghua: [
				{ id: 2, intensity: 0.5 },
				{ id: 4, intensity: 0.75 },
			],
		});
	});

	it("activates the GAN stage for per-face-only contour values", () => {
		const stages = stagesFor({
			adjustments: {
				enabled: true,
				values: {},
				faces: [{ trackId: 3, values: { face_adjust_lunkuopinghua: 100 } }],
			},
		});
		expect(stages).toHaveLength(1);
		expect(stages[0].targetFaceIds).toEqual([3]);
		expect(
			JSON.parse(stages[0].featureParameters).face_adjust_lunkuopinghua
		).toEqual([
			{ id: -1, intensity: 0 },
			{ id: 3, intensity: 1 },
		]);
	});

	it("does not build a GAN stage for neutral contour", () => {
		expect(
			stagesFor({
				adjustments: {
					enabled: true,
					values: { face_adjust_lunkuopinghua: 0 },
				},
			})
		).toEqual([]);
	});

	it.each([
		-1,
		101,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid contour intensity %s", (value) => {
		expect(() =>
			parseJianyingPortraitRenderRequest({
				request: {
					width: 2,
					height: 1,
					rgba: new Uint8Array(8),
					adjustments: {
						enabled: true,
						values: { face_adjust_lunkuopinghua: value },
					},
				},
			})
		).toThrow();
	});
});
