// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	normalizeMediaPortraitAdjustments,
	hasMediaPortraitAdjustments,
} from "../../packages/editor-core/src/portrait-adjustments.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	portraitFittingFrameAction,
	portraitPackageNeedsStableFrame,
} from "../jianying-portrait-adjustment-runtime/fitting-frame-state.js";
import {
	JIANYING_NOSE_3D_MODELS,
	missingJianyingNoseModels,
} from "../jianying-portrait-adjustment-runtime/nose-models.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
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

it("holds paused makeup, brow and 3D nose frames without freezing unrelated effects", () => {
	for (const runtimePackage of [
		"makeup",
		"brow-shape",
		"nose-3d",
		"nose-sculpt",
		"nose-upturned",
		"nose-hump",
	] as const) {
		expect(portraitPackageNeedsStableFrame({ runtimePackage })).toBe(true);
	}
	for (const runtimePackage of [
		"body",
		"smooth",
		"whiten",
		"clarity",
	] as const) {
		expect(portraitPackageNeedsStableFrame({ runtimePackage })).toBe(false);
	}
});

describe("3D nose routing", () => {
	it("gives the canonical label to 3D without changing the classic operator", () => {
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
				({ titleZh }) => titleZh === "鼻大小"
			)
		).toMatchObject([
			{
				key: "face_adjust_3DNose_Big",
				runtimePackage: "nose-3d",
				min: -50,
				max: 50,
				category: "nose",
			},
		]);
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				({ key }) => key === "face_adjust_nose"
			)
		).toMatchObject({
			runtimePackage: "features",
			titleZh: "鼻子大小（2D 基础）",
			min: -50,
			max: 50,
		});
	});
	it.each([
		-50, -25, 0, 25, 50,
	])("preserves signed UI value %s and targets only the 3D key", (value) => {
		const values = { face_adjust_3DNose_Big: value, face_adjust_nose: -48 };
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage: "nose-3d",
					values,
				})
			)
		).toEqual({
			face_adjust_3DNose_Big: [{ id: -1, intensity: value / 100 }],
		});
		const request = parseJianyingPortraitRenderRequest({
			request: {
				width: 2,
				height: 1,
				rgba: new Uint8Array(8),
				adjustments: { enabled: true, values },
			},
		});
		expect(request.adjustments.values.face_adjust_3DNose_Big ?? 0).toBe(value);
	});
	it("round trips independent old/new values and per-person settings", () => {
		const adjustments = {
			enabled: true,
			values: { face_adjust_nose: -48, face_adjust_3DNose_Big: 25 },
			faces: [{ trackId: 2, values: { face_adjust_3DNose_Big: -25 } }],
		};
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			})
		).toEqual(adjustments);
		expect(
			hasMediaPortraitAdjustments({
				adjustments: { enabled: true, values: { face_adjust_3DNose_Big: 25 } },
			})
		).toBe(true);
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: { enabled: true, values: { face_adjust_nose: -48 } },
			}).values
		).toEqual({ face_adjust_nose: -48 });
	});
	it("isolates 3D, skips zero, and keeps composition order explicit", () => {
		const stagesFor = (values: {
			face_adjust_3DNose_Big?: number;
			face_adjust_nose?: number;
			face_adjust_TotalFace?: number;
		}) =>
			buildJianyingPortraitRenderStages({
				request: {
					width: 2,
					height: 1,
					rgba: new Uint8Array(8),
					adjustments: { enabled: true, values },
				},
				packages,
				makeupCards: [],
			});
		expect(
			stagesFor({ face_adjust_3DNose_Big: 50 }).map(
				({ runtimePackage }) => runtimePackage
			)
		).toEqual(["nose-3d"]);
		expect(stagesFor({ face_adjust_3DNose_Big: 0 })).toEqual([]);
		expect(
			stagesFor({
				face_adjust_3DNose_Big: 50,
				face_adjust_nose: -48,
				face_adjust_TotalFace: 10,
			}).map(({ runtimePackage }) => runtimePackage)
		).toEqual(["face", "features", "nose-3d"]);
	});
	it("uses face overrides after the all-face fallback", () => {
		expect(
			JSON.parse(
				buildJianyingPortraitFeatureParameters({
					runtimePackage: "nose-3d",
					values: {},
					faceEntries: [{ id: 7, values: { face_adjust_3DNose_Big: -48 } }],
				})
			)
		).toEqual({
			face_adjust_3DNose_Big: [
				{ id: -1, intensity: 0 },
				{ id: 7, intensity: -0.48 },
			],
		});
	});
});

describe("3D nose frame history", () => {
	const previous = {
		inputHash: "frame-a",
		parameters: "value-25",
		timestampSeconds: 1,
	};
	it("renders the first frame", () =>
		expect(portraitFittingFrameAction({ current: previous })).toBe("render"));
	it.each([
		1, 1.033, 2,
	])("reuses identical source pixels at timestamp %s", (timestampSeconds) => {
		expect(
			portraitFittingFrameAction({
				previous,
				current: { ...previous, timestampSeconds },
			})
		).toBe("reuse");
	});
	it.each([
		{ parameters: "value-50" },
		{ inputHash: "changed-paused-frame" },
		{ timestampSeconds: 0.9 },
		{ timestampSeconds: 2.1 },
	])("resets on parameter changes, paused edits or seeks: %s", (change) => {
		expect(
			portraitFittingFrameAction({
				previous,
				current: { ...previous, ...change },
			})
		).toBe("reset");
	});
	it("keeps fitting history for adjacent moving frames", () => {
		expect(
			portraitFittingFrameAction({
				previous,
				current: { ...previous, inputHash: "frame-b", timestampSeconds: 1.033 },
			})
		).toBe("render");
	});
});

describe("3D nose assets", () => {
	it("requires every exact model family and rejects empty or similarly named substitutes", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "nose-models-"));
		try {
			expect(await missingJianyingNoseModels({ modelDirectory: null })).toEqual(
				[...JIANYING_NOSE_3D_MODELS]
			);
			await Promise.all(
				JIANYING_NOSE_3D_MODELS.map((model) =>
					writeFile(path.join(directory, `${model}_v1.model`), "synthetic")
				)
			);
			expect(
				await missingJianyingNoseModels({ modelDirectory: directory })
			).toEqual([]);
			await writeFile(path.join(directory, "tt_facefitting1220_v1.model"), "");
			await writeFile(
				path.join(directory, "tt_facefitting1256_v1.model"),
				"not a substitute"
			);
			expect(
				await missingJianyingNoseModels({ modelDirectory: directory })
			).toEqual(["tt_facefitting1220"]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("requires the dedicated package, not merely an algorithm config or generic features", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "nose-package-"));
		const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES["nose-3d"];
		const directory = path.join(
			home,
			"Movies/JianyingPro/User Data/Cache/effect",
			identity.resourceId,
			identity.version
		);
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "0");
		try {
			await mkdir(directory, { recursive: true });
			await writeFile(path.join(directory, "algorithmConfig.json"), "{}");
			expect(
				(await resolveJianyingPortraitPackage({ runtimePackage: "nose-3d" }))
					.packagePath
			).toBeNull();
			await mkdir(path.join(directory, "AmazingFeature/lua"), {
				recursive: true,
			});
			await Promise.all(
				[
					"config.json",
					"AmazingFeature/main.scene",
					"AmazingFeature/lua/Face3DSystem.lua",
				].map((file) => writeFile(path.join(directory, file), "synthetic"))
			);
			expect(
				await resolveJianyingPortraitPackage({ runtimePackage: "nose-3d" })
			).toMatchObject({
				packagePath: directory,
				source: "jianying-installation",
			});
			vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
			expect(
				(await resolveJianyingPortraitPackage({ runtimePackage: "nose-3d" }))
					.packagePath
			).toBeNull();
		} finally {
			spy.mockRestore();
			vi.unstubAllEnvs();
			await rm(home, { recursive: true, force: true });
		}
	});
});
