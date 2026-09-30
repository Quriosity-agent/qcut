// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	JIANYING_PORTRAIT_MAKEUP_CARDS,
	jianyingPortraitMakeupCard,
} from "../jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

describe("portrait brow makeup catalog and legacy compatibility", () => {
	it("keeps the original mapping but excludes it from new makeup choices", () => {
		const legacy = jianyingPortraitMakeupCard({ id: "brows-flow" });
		expect(legacy).toMatchObject({
			category: "brows",
			titleZh: "流畅眉",
			resourceId: "7406174746829737231",
			version: "b6c830cdf68c163cd3dc2139db6b1fee",
			parameterKey: "eyebrow_adjust_BiaoZhun",
			defaultIntensity: 70,
			kind: "standalone",
			legacyOnly: true,
		});
		expect(
			JIANYING_PORTRAIT_MAKEUP_CARDS.filter(({ legacyOnly }) => legacyOnly).map(
				({ id }) => id
			)
		).toEqual(["brows-flow"]);
		expect(
			JIANYING_PORTRAIT_MAKEUP_CARDS.filter(
				({ category, legacyOnly }) => category === "brows" && !legacyOnly
			).map(({ titleZh }) => titleZh)
		).toEqual(["标准眉", "绒绒眉", "野生眉", "侠客眉", "古韵眉", "淡颜眉"]);
	});

	it("has 20 unique mappings and 19 new selections, including six dynamic brow styles in native order", () => {
		expect(JIANYING_PORTRAIT_MAKEUP_CARDS).toHaveLength(20);
		expect(
			new Set(JIANYING_PORTRAIT_MAKEUP_CARDS.map(({ id }) => id)).size
		).toBe(20);
		expect(
			JIANYING_PORTRAIT_MAKEUP_CARDS.filter(({ legacyOnly }) => !legacyOnly)
		).toHaveLength(19);
		const brows = JIANYING_PORTRAIT_MAKEUP_CARDS.filter(
			({ category }) => category === "brows"
		);
		expect(brows.map(({ id }) => id)).toEqual([
			"brows-flow",
			"brows-standard",
			"brows-fluffy",
			"brows-wild",
			"brows-warrior",
			"brows-classical",
			"brows-soft",
		]);
		for (const card of brows.filter(({ legacyOnly }) => !legacyOnly)) {
			expect(card.kind).toBe("dynamic");
			expect(card.defaultIntensity).toBe(80);
		}
	});

	it.each([
		{
			id: "brows-standard",
			resourceId: "7406180431730707727",
			version: "1826bb4815f127fb3168b67ed4e0fc71",
			parameterKey: "face_adjust_brow_biaozhunmei",
		},
		{
			id: "brows-wild",
			resourceId: "7406181254669929763",
			version: "2041638b555e988c0b6f13839b112659",
			parameterKey: "face_adjust_brow_yeshengmeiii",
		},
		{
			id: "brows-warrior",
			resourceId: "7406174539454909730",
			version: "8feebde948245fa77c49ead859794fb1",
			parameterKey: "face_adjust_brow_xiakemei",
		},
		{
			id: "brows-classical",
			resourceId: "7406175039264951592",
			version: "212083cfb14f276308e23a3ee39a9034",
			parameterKey: "face_adjust_brow_guyunmeifree",
		},
		{
			id: "brows-soft",
			resourceId: "7406174445548719394",
			version: "ed8ca9399d3ef88ea59931f6f57885a1",
			parameterKey: "face_adjust_brow_danyanmei",
		},
	])("uses the supplied native metadata and dynamic parameter for $id", ({
		id,
		...metadata
	}) => {
		const card = jianyingPortraitMakeupCard({ id });
		expect(card).toMatchObject({
			id,
			...metadata,
			category: "brows",
			kind: "dynamic",
			defaultIntensity: 80,
		});
		expect(card?.legacyOnly).not.toBe(true);
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width: 1,
				height: 1,
				rgba: new Uint8Array(4),
				adjustments: {
					enabled: true,
					values: {},
					makeup: { brows: { cardId: id, intensity: 80 } },
				},
			},
		});
		const stages = buildJianyingPortraitRenderStages({
			request,
			packages: [
				{
					runtimePackage: "makeup",
					group: "face",
					packagePath: "/runtime/makeup",
					source: "qcut-private",
				},
			],
			makeupCards: JIANYING_PORTRAIT_MAKEUP_CARDS.map((definition) => ({
				card: definition,
				packagePath: `/cards/${definition.id}`,
				source: "qcut-private" as const,
			})),
		});
		expect(stages).toHaveLength(1);
		expect(stages[0].id).toBe(`makeup-dynamic:${id}`);
		expect(JSON.parse(stages[0].featureParameters)).toEqual({
			[metadata.parameterKey]: [
				{ id: -1, intensity: 0.8, path: `/cards/${id}` },
			],
		});
	});

	it.each([
		{ globalIntensity: 70, faceIntensity: 35 },
		{ globalIntensity: 0, faceIntensity: 35 },
		{ globalIntensity: 70, faceIntensity: 0 },
		{ globalIntensity: 0, faceIntensity: 0 },
	])("preserves and renders saved global $globalIntensity / face $faceIntensity strengths", ({
		globalIntensity,
		faceIntensity,
	}) => {
		const adjustments = {
			enabled: true,
			values: {},
			makeup: { brows: { cardId: "brows-flow", intensity: globalIntensity } },
			faces: [
				{
					trackId: 2,
					values: {},
					makeup: { brows: { cardId: "brows-flow", intensity: faceIntensity } },
				},
			],
		};
		const request = parseJianyingPortraitRenderRequest({
			request: { width: 1, height: 1, rgba: new Uint8Array(4), adjustments },
		});
		expect(request.adjustments).toEqual(adjustments);
		const stages = buildJianyingPortraitRenderStages({
			request,
			packages: [],
			makeupCards: JIANYING_PORTRAIT_MAKEUP_CARDS.map((card) => ({
				card,
				packagePath: `/cards/${card.id}`,
				source: "qcut-private" as const,
			})),
		});
		if (globalIntensity === 0 && faceIntensity === 0) {
			expect(stages).toEqual([]);
			return;
		}
		expect(stages).toHaveLength(1);
		expect(stages[0]).toMatchObject({
			id: "makeup-card:brows-flow",
			packagePath: "/cards/brows-flow",
			targetFaceIds: faceIntensity > 0 ? [2] : [],
		});
		expect(JSON.parse(stages[0].featureParameters)).toEqual({
			eyebrow_adjust_BiaoZhun: [
				{ id: -1, intensity: globalIntensity / 100 },
				...(faceIntensity > 0
					? [{ id: 2, intensity: faceIntensity / 100 }]
					: []),
			],
		});
	});
});
