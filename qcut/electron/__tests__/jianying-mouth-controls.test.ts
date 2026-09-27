// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeMediaPortraitAdjustments } from "../../packages/editor-core/src/portrait-adjustments.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

const controls = [
	{
		key: "face_adjust_Smile",
		runtimePackage: "smile",
		nativeKey: "face_adjust_SmallFace",
		limit: 100,
	},
] as const;
const packages = JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map(
	(runtimePackage) => ({
		runtimePackage,
		group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
		packagePath: `/runtime/${runtimePackage}`,
		source: "qcut-private" as const,
	})
);

describe("mouth reference controls", () => {
	it("keeps six canonical controls and moves legacy operators to detail", () => {
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
				(control) => "category" in control && control.category === "mouth"
			).map(({ titleZh }) => titleZh)
		).toEqual(["白牙", "嘴大小", "嘴高低", "嘴倾斜", "微笑唇", "笑容"]);
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_mouse_corner"
			)
		).toMatchObject({
			runtimePackage: "features",
			category: "mouth",
			titleZh: "微笑唇",
		});
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_SmallFace"
			)
		).toMatchObject({ section: "face-shape", titleZh: "短脸", min: 0 });
	});
	it.each(
		controls
	)("isolates $key across signed values and per-person entries", ({
		key,
		nativeKey,
		runtimePackage,
		limit,
	}) => {
		for (const value of [-limit, -limit / 2, 0, limit / 2, limit]) {
			const parameters = JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage,
					values: {
						[key]: value,
						face_adjust_SmallFace: 80,
						face_adjust_mouse_corner: 30,
					},
					faceEntries: [{ id: 7, values: { [key]: -value } }],
				})
			);
			expect(parameters).toEqual({
				[nativeKey]: [
					{ id: -1, intensity: value / 100 },
					{ id: 7, intensity: -value / 100 || 0 },
				],
			});
		}
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({ runtimePackage, values: {} })
			)
		).toEqual({ [nativeKey]: [{ id: -1, intensity: 0 }] });
	});
	it.each(
		controls
	)("validates $key independently and fails closed without its package", ({
		key,
		runtimePackage,
		limit,
	}) => {
		for (const value of [-limit - 1, limit + 1, Number.NaN, Infinity]) {
			expect(() =>
				parseJianyingPortraitRenderRequest({
					request: {
						width: 2,
						height: 1,
						rgba: new Uint8Array(8),
						adjustments: { enabled: true, values: { [key]: value } },
					},
				})
			).toThrow();
		}
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width: 2,
				height: 1,
				rgba: new Uint8Array(8),
				adjustments: { enabled: true, values: { [key]: -limit } },
			},
		});
		expect(
			buildJianyingPortraitRenderStages({
				request,
				packages,
				makeupCards: [],
			}).map((stage) => stage.runtimePackage)
		).toEqual([runtimePackage]);
		expect(() =>
			buildJianyingPortraitRenderStages({
				request,
				packages: packages.filter(
					(candidate) => candidate.runtimePackage !== runtimePackage
				),
				makeupCards: [],
			})
		).toThrow(runtimePackage);
	});
	it("preserves old and new keys through save and emits distinct stages", () => {
		const adjustments = {
			enabled: true,
			values: {
				face_adjust_SmallFace: 30,
				face_adjust_Smile: -50,
				face_adjust_mouse_corner: 10,
				face_adjust_mouse_width: 25,
			},
			faces: [{ trackId: 8, values: { face_adjust_Smile: 50 } }],
		};
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			})
		).toEqual(adjustments);
		const request = parseJianyingPortraitRenderRequest({
			request: { width: 2, height: 1, rgba: new Uint8Array(8), adjustments },
		});
		const stages = buildJianyingPortraitRenderStages({
			request,
			packages,
			makeupCards: [],
		});
		expect(stages.map(({ runtimePackage }) => runtimePackage)).toEqual([
			"face",
			"features",
			"smile",
		]);
		const face = stages.find(({ runtimePackage }) => runtimePackage === "face");
		const smile = stages.find(
			({ runtimePackage }) => runtimePackage === "smile"
		);
		expect(
			JSON.parse(face?.featureParameters ?? "{}").face_adjust_SmallFace[0]
				.intensity
		).toBe(0.3);
		expect(
			JSON.parse(smile?.featureParameters ?? "{}").face_adjust_SmallFace[0]
				.intensity
		).toBe(-0.5);
	});
	it("requires the smile controller and honors cache opt-out", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "mouth-package-"));
		const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.smile;
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
				(await resolveJianyingPortraitPackage({ runtimePackage: "smile" }))
					.packagePath
			).toBeNull();
			await Promise.all(
				[
					"config.json",
					"AmazingFeature/main.scene",
					"AmazingFeature/lua/FaceReshapeControlSystem.lua",
				].map((filename) =>
					writeFile(path.join(directory, filename), "synthetic")
				)
			);
			expect(
				await resolveJianyingPortraitPackage({ runtimePackage: "smile" })
			).toMatchObject({
				packagePath: directory,
				source: "jianying-installation",
			});
			vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
			expect(
				(await resolveJianyingPortraitPackage({ runtimePackage: "smile" }))
					.packagePath
			).toBeNull();
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
			await rm(home, { recursive: true, force: true });
		}
	});
});
