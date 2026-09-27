// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	hasMediaPortraitAdjustments,
	normalizeMediaPortraitAdjustments,
} from "../../packages/editor-core/src/portrait-adjustments.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

const keys = ["face_adjust_MouthTilted", "face_adjust_EyeTilted"] as const;
const packages = JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map(
	(runtimePackage) => ({
		runtimePackage,
		group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
		packagePath: `/runtime/${runtimePackage}`,
		source: "qcut-private" as const,
	})
);

describe("mouth and eye tilt", () => {
	it.each([
		{ key: keys[0], category: "mouth", titleZh: "嘴倾斜" },
		{ key: keys[1], category: "eyes", titleZh: "眼倾斜" },
	])("exposes $titleZh as an independent signed control", ({
		key,
		category,
		titleZh,
	}) => {
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				(control) => control.key === key
			)
		).toMatchObject({
			category,
			titleZh,
			min: -100,
			max: 100,
			step: 1,
			runtimePackage: "feature-tilt",
		});
	});
	it.each([
		-100, -50, 0, 50, 100,
	])("emits signed vectors once at value %s", (value) => {
		const values = {
			face_adjust_MouthTilted: value,
			face_adjust_EyeTilted: -value,
		};
		const parameters = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "feature-tilt",
				values,
			})
		);
		expect(parameters).toEqual({
			face_adjust_MouthTilted: [{ id: -1, intensity: value / 100 }],
			face_adjust_EyeTilted: [{ id: -1, intensity: -value / 100 || 0 }],
		});
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width: 2,
				height: 1,
				rgba: new Uint8Array(8),
				adjustments: { enabled: true, values },
			},
		});
		expect(request.adjustments.values.face_adjust_MouthTilted ?? 0).toBe(value);
		expect(request.adjustments.values.face_adjust_EyeTilted ?? 0).toBe(-value);
		const stages = buildJianyingPortraitRenderStages({
			request,
			packages,
			makeupCards: [],
		});
		expect(stages.map(({ runtimePackage }) => runtimePackage)).toEqual(
			value === 0 ? [] : ["feature-tilt"]
		);
	});
	it.each([
		101,
		-101,
		Number.NaN,
		Infinity,
	])("rejects invalid intensity %s", (value) => {
		expect(() =>
			parseJianyingPortraitRenderRequest({
				request: {
					width: 2,
					height: 1,
					rgba: new Uint8Array(8),
					adjustments: {
						enabled: true,
						values: { face_adjust_MouthTilted: value },
					},
				},
			})
		).toThrow();
	});
	it("preserves old parameters, both tilt keys, and per-person overrides across serialization", () => {
		const adjustments = {
			enabled: true,
			values: {
				face_adjust_MouthTilted: -100,
				face_adjust_EyeTilted: 50,
				face_adjust_MouthCorner: 25,
			},
			faces: [{ trackId: 7, values: { face_adjust_EyeTilted: -50 } }],
		};
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			})
		).toEqual(adjustments);
		expect(hasMediaPortraitAdjustments({ adjustments })).toBe(true);
		expect(
			hasMediaPortraitAdjustments({
				adjustments: { enabled: true, values: {}, faces: adjustments.faces },
			})
		).toBe(true);
		expect(
			hasMediaPortraitAdjustments({
				adjustments: { ...adjustments, enabled: false },
			})
		).toBe(false);
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage: "feature-tilt",
					values: adjustments.values,
					faceEntries: [{ id: 7, values: { face_adjust_EyeTilted: -50 } }],
				})
			)
		).toEqual({
			face_adjust_MouthTilted: [
				{ id: -1, intensity: -1 },
				{ id: 7, intensity: 0 },
			],
			face_adjust_EyeTilted: [
				{ id: -1, intensity: 0.5 },
				{ id: 7, intensity: -0.5 },
			],
		});
	});
	it("does not silently fall back when the dedicated package is absent", () => {
		expect(() =>
			buildJianyingPortraitRenderStages({
				request: {
					width: 2,
					height: 1,
					rgba: new Uint8Array(8),
					adjustments: {
						enabled: true,
						values: { face_adjust_EyeTilted: 100 },
					},
				},
				packages: packages.filter(
					({ runtimePackage }) => runtimePackage !== "feature-tilt"
				),
				makeupCards: [],
			})
		).toThrow("feature-tilt");
	});
	it("requires the tilt scene and controller, and honors the user-cache opt-out", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "tilt-package-"));
		const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES["feature-tilt"];
		const directory = path.join(
			home,
			"Movies/JianyingPro/User Data/Cache/effect",
			identity.resourceId,
			identity.version
		);
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "0");
		try {
			await mkdir(path.join(directory, "AmazingFeature/lua"), {
				recursive: true,
			});
			await writeFile(path.join(directory, "algorithmConfig.json"), "{}");
			expect(
				(
					await resolveJianyingPortraitPackage({
						runtimePackage: "feature-tilt",
					})
				).packagePath
			).toBeNull();
			await Promise.all(
				[
					"config.json",
					"AmazingFeature/main.scene",
					"AmazingFeature/lua/FaceReshapeControlSystem.lua",
				].map((file) => writeFile(path.join(directory, file), "synthetic"))
			);
			expect(
				await resolveJianyingPortraitPackage({ runtimePackage: "feature-tilt" })
			).toMatchObject({
				packagePath: directory,
				source: "jianying-installation",
			});
			vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
			expect(
				(
					await resolveJianyingPortraitPackage({
						runtimePackage: "feature-tilt",
					})
				).packagePath
			).toBeNull();
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
			await rm(home, { recursive: true, force: true });
		}
	});
});
