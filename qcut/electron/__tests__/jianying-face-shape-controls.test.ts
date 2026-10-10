// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeMediaPortraitAdjustments } from "../../packages/editor-core/src/portrait-adjustments.js";
import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import { buildJianyingPortraitRenderStages } from "../jianying-portrait-adjustment-runtime/stages.js";

const operators = [
	{
		key: "face_adjust_YouTaiFace",
		runtimePackage: "small-face",
		titleZh: "小脸",
	},
	{
		key: "face_adjust_XiaHeXian",
		runtimePackage: "jawline",
		titleZh: "下颌线",
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

function stagesFor({ adjustments }: { adjustments: MediaPortraitAdjustments }) {
	return buildJianyingPortraitRenderStages({
		request: { width: 2, height: 1, rgba: new Uint8Array(8), adjustments },
		packages,
		makeupCards: [],
	});
}

describe("independent face shape operators", () => {
	it.each(operators)("routes $titleZh only to its dedicated package", ({
		key,
		runtimePackage,
		titleZh,
	}) => {
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
				(control) => control.titleZh === titleZh
			)
		).toMatchObject([
			{ key, runtimePackage, section: "face-shape", min: 0, max: 100 },
		]);
		const stages = stagesFor({
			adjustments: { enabled: true, values: { [key]: 50 } },
		});
		expect(stages.map((stage) => stage.runtimePackage)).toEqual([
			runtimePackage,
		]);
		expect(JSON.parse(stages[0].featureParameters)).toEqual({
			[key]: [{ id: -1, intensity: 0.5 }],
		});
	});

	it.each(
		operators
	)("bypasses neutral $titleZh and preserves per-face settings", ({
		key,
		runtimePackage,
	}) => {
		expect(
			stagesFor({ adjustments: { enabled: true, values: { [key]: 0 } } })
		).toEqual([]);
		const stages = stagesFor({
			adjustments: {
				enabled: true,
				values: {},
				faces: [{ trackId: 7, values: { [key]: 75 } }],
			},
		});
		expect(stages).toHaveLength(1);
		expect(stages[0]).toMatchObject({ runtimePackage, targetFaceIds: [7] });
		expect(JSON.parse(stages[0].featureParameters)).toEqual({
			[key]: [
				{ id: -1, intensity: 0 },
				{ id: 7, intensity: 0.75 },
			],
		});
	});

	it.each(operators)("does not emit other face operators into $titleZh", ({
		key,
		runtimePackage,
	}) => {
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage,
					values: { face_adjust_SmallFace: 80, face_adjust_jaw: 65, [key]: 50 },
					targetFaceId: 2,
					faceEntries: [{ id: 4, values: { [key]: 100 } }],
				})
			)
		).toEqual({
			[key]: [
				{ id: 2, intensity: 0.5 },
				{ id: 4, intensity: 1 },
			],
		});
	});

	it.each(
		operators.flatMap((operator) =>
			[-1, 101, Number.NaN, Number.POSITIVE_INFINITY].map((value) => ({
				...operator,
				value,
			}))
		)
	)("rejects invalid $titleZh intensity $value", ({ key, value }) => {
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
	});

	it("keeps short face and legacy chin on their original packages", () => {
		const values = { face_adjust_SmallFace: 45, face_adjust_jaw: 35 };
		expect(
			stagesFor({ adjustments: { enabled: true, values } }).map(
				(stage) => stage.runtimePackage
			)
		).toEqual(["face", "features"]);
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_SmallFace"
			)
		).toMatchObject({ titleZh: "短脸", section: "face-shape" });
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_jaw"
			)
		).toMatchObject({
			titleZh: "下巴轮廓（基础）",
			runtimePackage: "features",
			section: "features",
			category: "details",
		});
	});

	it("round trips old and new values independently without a migration", () => {
		const adjustments = {
			enabled: true,
			values: {
				face_adjust_SmallFace: 40,
				face_adjust_jaw: 30,
				face_adjust_YouTaiFace: 50,
				face_adjust_XiaHeXian: 60,
			},
			faces: [
				{
					trackId: 2,
					values: { face_adjust_YouTaiFace: 75, face_adjust_XiaHeXian: 80 },
				},
			],
		};
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			})
		).toEqual(adjustments);
	});

	it("composes old and new packages in an explicit deterministic order", () => {
		const stages = stagesFor({
			adjustments: {
				enabled: true,
				values: {
					face_adjust_lunkuopinghua: 50,
					face_adjust_SmallFace: 25,
					face_adjust_jaw: 20,
					face_adjust_YouTaiFace: 50,
					face_adjust_XiaHeXian: 75,
				},
			},
		});
		expect(stages.map((stage) => stage.runtimePackage)).toEqual([
			"skin-gan",
			"face",
			"features",
			"small-face",
			"jawline",
		]);
	});

	it("fails explicitly if the active jawline package is missing", () => {
		expect(() =>
			buildJianyingPortraitRenderStages({
				request: {
					width: 2,
					height: 1,
					rgba: new Uint8Array(8),
					adjustments: { enabled: true, values: { face_adjust_XiaHeXian: 50 } },
				},
				packages: packages.filter(
					({ runtimePackage }) => runtimePackage !== "jawline"
				),
				makeupCards: [],
			})
		).toThrow("jawline");
	});
});

describe("face shape package completeness", () => {
	it.each([
		{
			runtimePackage: "small-face",
			files: [
				"algorithmConfig.json",
				"config.json",
				"AmazingFeature/main.scene",
				"AmazingFeature/lua/reshape.lua",
			],
		},
		{
			runtimePackage: "jawline",
			files: [
				"algorithmConfig.json",
				"config.json",
				"AmazingFeature/main.scene",
				"AmazingFeature/lua/FaceWarpXControl.lua",
				"AmazingFeature_shadow/main.scene",
				"AmazingFeature_shadow/lua/makeup.lua",
			],
		},
	] as const)("requires all $runtimePackage scenes and controllers", async ({
		runtimePackage,
		files,
	}) => {
		const home = await mkdtemp(path.join(os.tmpdir(), "face-shape-package-"));
		const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
		const directory = path.join(
			home,
			"Movies/JianyingPro/User Data/Cache/effect",
			identity.resourceId,
			identity.version
		);
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "0");
		try {
			await Promise.all(
				files.map(async (file) => {
					await mkdir(path.dirname(path.join(directory, file)), {
						recursive: true,
					});
					await writeFile(path.join(directory, file), "synthetic fixture");
				})
			);
			expect(
				await resolveJianyingPortraitPackage({ runtimePackage })
			).toMatchObject({
				packagePath: directory,
				source: "jianying-installation",
			});
			await files.reduce(async (previous, file) => {
				await previous;
				await rm(path.join(directory, file));
				expect(
					(await resolveJianyingPortraitPackage({ runtimePackage })).packagePath
				).toBeNull();
				await writeFile(path.join(directory, file), "synthetic fixture");
			}, Promise.resolve());
			vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
			expect(
				(await resolveJianyingPortraitPackage({ runtimePackage })).packagePath
			).toBeNull();
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
			await rm(home, { recursive: true, force: true });
		}
	});
});
