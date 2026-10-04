// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	hasMediaPortraitAdjustments,
	normalizeMediaPortraitAdjustments,
	MEDIA_PORTRAIT_SKIN_TONE_RESOURCE_IDS,
} from "../../packages/editor-core/src/portrait-adjustments";
import { validateMediaElement } from "../../packages/jianying-draft-export/src/snapshot-media-runtime-validation";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../jianying-portrait-adjustment-runtime/skin-tone-catalog";
import { JIANYING_PORTRAIT_PACKAGE_IDENTITIES } from "../jianying-portrait-adjustment-runtime/catalog";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-contract";
import type { JianyingPortraitPackageResolution } from "../jianying-portrait-adjustment-runtime/package-resolver";

const values = {
	face_adjust_skin_Intensity: 60,
	face_adjust_skin_ColdWarm: -25,
};
function parse({ adjustments }: { adjustments: unknown }) {
	return parseJianyingPortraitRenderRequest({
		request: {
			width: 1,
			height: 1,
			rgba: new Uint8Array([100, 100, 100, 255]),
			adjustments,
		},
	});
}
function stages({
	adjustments,
	packages = [],
}: {
	adjustments: MediaPortraitAdjustments;
	packages?: JianyingPortraitPackageResolution[];
}) {
	return buildJianyingPortraitRenderStages({
		request: parse({ adjustments }),
		packages,
		makeupCards: [],
	});
}

describe("skin tone resource contract and dispatch", () => {
	it("pins the five catalog resources and preserves the historical pink identity", () => {
		expect(
			JIANYING_PORTRAIT_SKIN_TONES.map(({ resourceId }) => resourceId)
		).toEqual(MEDIA_PORTRAIT_SKIN_TONE_RESOURCE_IDS);
		expect(JIANYING_PORTRAIT_SKIN_TONES.map(({ color }) => color)).toEqual([
			"#A9775D",
			"#fad1c0",
			"#fdebe2",
			"#ffdcba",
			"#d6a273",
		]);
		expect(JIANYING_PORTRAIT_PACKAGE_IDENTITIES["skin-tone"]).toEqual({
			resourceId: "7408757645705760000",
			version: "c36221f2a2097535ce1a2f70cd9e0116",
			group: "face",
		});
	});
	it.each(
		JIANYING_PORTRAIT_SKIN_TONES
	)("dispatches $titleEn as a package, with only the two verified global events", ({
		resourceId,
	}) => {
		const adjustments: MediaPortraitAdjustments = {
			enabled: true,
			values,
			skinToneResourceId: resourceId,
			faceTarget: { mode: "single", faceId: 3 },
		};
		const [stage] = stages({
			adjustments,
			packages: [
				{
					group: "face",
					runtimePackage: "skin-tone",
					source: "qcut-private",
					packagePath: `/packages/${resourceId}`,
					skinToneResourceId: resourceId,
				},
			],
		});
		expect(stage).toMatchObject({
			id: `skin-tone:${resourceId}`,
			packagePath: `/packages/${resourceId}`,
			targetFaceIds: [],
		});
		expect(JSON.parse(stage.featureParameters)).toEqual({
			face_adjust_skin_Intensity: [{ id: -1, intensity: 0.6 }],
			face_adjust_skin_ColdWarm: [{ id: -1, intensity: -0.25 }],
		});
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			}).skinToneResourceId
		).toBe(resourceId);
	});
	it("keeps absent selection on the legacy path without adding serialized fields", () => {
		const adjustments = { enabled: true, values };
		expect(normalizeMediaPortraitAdjustments({ adjustments })).toEqual(
			adjustments
		);
		expect(parse({ adjustments }).adjustments).not.toHaveProperty(
			"skinToneResourceId"
		);
		expect(
			stages({
				adjustments,
				packages: [
					{
						group: "face",
						runtimePackage: "skin-tone",
						source: "qcut-private",
						packagePath: "/pinned-pink",
					},
				],
			})[0]
		).toMatchObject({ id: "package:skin-tone", packagePath: "/pinned-pink" });
	});
	it("None suppresses stale global and per-face warmth, without resolving a package", () => {
		const adjustments: MediaPortraitAdjustments = {
			enabled: true,
			values,
			skinToneResourceId: null,
			faces: [{ trackId: 0, values: { face_adjust_skin_ColdWarm: 50 } }],
		};
		expect(stages({ adjustments })).toEqual([]);
		expect(hasMediaPortraitAdjustments({ adjustments })).toBe(false);
		expect(parse({ adjustments }).adjustments.skinToneResourceId).toBeNull();
		expect(
			normalizeMediaPortraitAdjustments({ adjustments }).skinToneResourceId
		).toBeNull();
	});
	it("retains a selected resource at zero and dispatches warmth without intensity", () => {
		const skinToneResourceId = JIANYING_PORTRAIT_SKIN_TONES[0].resourceId;
		const adjustments = { enabled: true, skinToneResourceId, values: {} };
		expect(stages({ adjustments })).toEqual([]);
		expect(() =>
			stages({
				adjustments: {
					...adjustments,
					values: { face_adjust_skin_ColdWarm: 25 },
				},
			})
		).toThrow("unavailable");
	});
	it("never falls back to pink when the selected resource is missing", () => {
		expect(() =>
			stages({
				adjustments: {
					enabled: true,
					values,
					skinToneResourceId: JIANYING_PORTRAIT_SKIN_TONES[0].resourceId,
				},
				packages: [
					{
						group: "face",
						runtimePackage: "skin-tone",
						source: "qcut-private",
						packagePath: "/pinned-pink",
					},
				],
			})
		).toThrow("unavailable");
	});
	it.each([
		0,
		4,
		"0",
		"../7408757645705743616",
		"unknown",
		{},
		false,
	])("rejects an unverified selection %j", (skinToneResourceId) => {
		expect(() =>
			parse({ adjustments: { enabled: true, values, skinToneResourceId } })
		).toThrow("Unknown portrait skin tone resource");
	});
	it("rejects palette selection on per-face entries and conflicting per-face tone values", () => {
		const skinToneResourceId = JIANYING_PORTRAIT_SKIN_TONES[0].resourceId;
		expect(() =>
			parse({
				adjustments: {
					enabled: true,
					values: {},
					faces: [{ trackId: 0, values: {}, skinToneResourceId }],
				},
			})
		).toThrow("global-only");
		expect(() =>
			parse({
				adjustments: {
					enabled: true,
					values,
					skinToneResourceId,
					faces: [{ trackId: 1, values }],
				},
			})
		).toThrow("per-face skin tone values");
	});
	it.each([
		-51,
		51,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects out-of-contract warmth %j", (warmth) => {
		expect(() =>
			parse({
				adjustments: {
					enabled: true,
					values: { face_adjust_skin_ColdWarm: warmth },
				},
			})
		).toThrow();
	});
	it.each([
		...MEDIA_PORTRAIT_SKIN_TONE_RESOURCE_IDS,
		null,
	])("allows %j through snapshot export validation", (skinToneResourceId) => {
		expect(() =>
			validateMediaElement({
				element: {
					mediaId: "media",
					portraitAdjustments: { enabled: true, values, skinToneResourceId },
				},
				path: "element",
			})
		).not.toThrow();
	});
	it("keeps snapshot export closed to fabricated IDs and palette indices", () => {
		expect(() =>
			validateMediaElement({
				element: {
					mediaId: "media",
					portraitAdjustments: {
						enabled: true,
						values,
						skinToneResourceId: "4",
					},
				},
				path: "element",
			})
		).toThrow("skinToneResourceId");
	});
});
