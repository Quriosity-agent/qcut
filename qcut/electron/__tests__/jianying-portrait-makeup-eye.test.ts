// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	JIANYING_PORTRAIT_MAKEUP_CARDS,
	buildJianyingDynamicMakeupParameters,
	jianyingPortraitMakeupCard,
} from "../jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

const references = [
	[
		"aegyo-doll",
		"7406174836470435107",
		"ddec788c25c5898131588abc5852b23e",
		"face_adjust_eyemazing_wawa",
	],
	[
		"aegyo-born",
		"7406181438145580288",
		"0946881a933ddcf5d46d2148ec4f1eeb",
		"face_adjust_eyemazing_masheng",
	],
	[
		"aegyo-bittersweet",
		"7406180529726344463",
		"88de63139cbef0e7aa78bb3c34148378",
		"face_adjust_eyemazing_tiansang",
	],
	[
		"aegyo-peach",
		"7406173948041252131",
		"face184b4f48bdbf68dfe3b6b0d79c39",
		"face_adjust_eyemazing_taohua",
	],
	[
		"aegyo-campus",
		"7406174769218997544",
		"1c91f21149f2daea1f77972f88dbf7df",
		"face_adjust_eyemazing_xiaohua",
	],
	[
		"eyeliner-playful",
		"7406179874521632035",
		"71795027dd763624788b67517cfa3048",
		"face_adjust_eyeline_qiaopi",
	],
	[
		"eyeliner-alluring",
		"7406180977199942947",
		"6a7185c6d0ab4ad1b9e46853f9ce926e",
		"face_adjust_eyeline_wumei",
	],
	[
		"eyeliner-detached",
		"7406174933820198196",
		"8f8b7b5d3ee885ba1d4f83b597b8ccf8",
		"face_adjust_eyeline_yanshi",
	],
	[
		"eyeliner-warrior",
		"7406174026269199668",
		"064da06e9def650032c089de7cfdfcb7",
		"face_adjust_eyeline_xiake",
	],
] as const;
const cases = references.map(([id, resourceId, version, parameterKey]) => ({
	id,
	resourceId,
	version,
	parameterKey,
}));

describe("native eye makeup coverage", () => {
	it.each([
		{ category: "aegyo" },
		{ category: "eyeliner" },
	] as const)("covers the six cached $category styles", ({ category }) => {
		const cards = JIANYING_PORTRAIT_MAKEUP_CARDS.filter(
			({ category: cardCategory }) => cardCategory === category
		);
		expect(cards).toHaveLength(6);
		expect(new Set(cards.map(({ parameterKey }) => parameterKey)).size).toBe(6);
		expect(
			cards.every(
				({ kind, defaultIntensity, legacyOnly }) =>
					kind === "dynamic" && defaultIntensity === 80 && !legacyOnly
			)
		).toBe(true);
	});

	it.each(cases)("matches effect-package configuration for $id", ({
		id,
		resourceId,
		version,
		parameterKey,
	}) => {
		const card = jianyingPortraitMakeupCard({ id });
		expect(card).toMatchObject({
			resourceId,
			version,
			parameterKey,
			defaultIntensity: 80,
		});
		if (!card) throw new Error(`Missing ${id}`);
		const parameters = buildJianyingDynamicMakeupParameters({
			selections: [
				{
					card,
					intensity: 80,
					packagePath: `/cards/${id}`,
					faceEntries: [{ id: 3, intensity: 25 }],
				},
			],
			targetFaceId: -1,
		});
		expect(JSON.parse(parameters)).toEqual({
			[parameterKey]: [
				{ id: -1, intensity: 0.8, path: `/cards/${id}` },
				{ id: 3, intensity: 0.25, path: `/cards/${id}` },
			],
		});
	});

	it.each(
		cases
	)("retains the selected $id at zero without scheduling a render", ({
		id,
	}) => {
		const card = jianyingPortraitMakeupCard({ id });
		if (!card) throw new Error(`Missing ${id}`);
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width: 1,
				height: 1,
				rgba: new Uint8Array(4),
				adjustments: {
					enabled: true,
					values: {},
					makeup: { [card.category]: { cardId: id, intensity: 0 } },
				},
			},
		});
		expect(request.adjustments.makeup?.[card.category]).toEqual({
			cardId: id,
			intensity: 0,
		});
		expect(
			buildJianyingPortraitRenderStages({
				request,
				packages: [],
				makeupCards: [],
			})
		).toEqual([]);
	});
});
