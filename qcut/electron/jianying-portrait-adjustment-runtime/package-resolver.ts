import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	JianyingPortraitAdjustmentGroup,
	JianyingPortraitAdjustmentRuntimePackage,
	MediaPortraitSkinToneResourceId,
} from "./jianying-portrait-adjustment-contract.js";
import { jianyingFilterPrivateRuntimeCurrent } from "../jianying-filter-local-runtime/private-runtime.js";
import {
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "./catalog.js";
import {
	JIANYING_PORTRAIT_SKIN_TONES,
	parsePortraitSkinToneResourceId,
} from "./skin-tone-catalog.js";

export interface JianyingPortraitPackageResolution {
	group: JianyingPortraitAdjustmentGroup;
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	packagePath: string | null;
	source: "qcut-private" | "jianying-installation" | "none";
	skinToneResourceId?: MediaPortraitSkinToneResourceId;
}

async function isReadableDirectory({
	directory,
	requiredFiles,
}: {
	directory: string;
	requiredFiles: string[];
}): Promise<boolean> {
	try {
		await Promise.all([
			access(directory, constants.R_OK),
			...requiredFiles.map((file) =>
				access(path.join(directory, file), constants.R_OK)
			),
		]);
		return true;
	} catch {
		return false;
	}
}

function installedCacheRoot() {
	return path.join(os.homedir(), "Movies", "JianyingPro", "User Data", "Cache");
}

const PACKAGE_SCRIPTS: Partial<
	Record<JianyingPortraitAdjustmentRuntimePackage, string>
> = {
	"nose-3d": "Face3DSystem.lua",
	"nose-sculpt": "Masheng.lua",
	"nose-upturned": "XiaoQiaoBi.lua",
	"nose-hump": "Tuofeng.lua",
	"brow-shape": "FaceReshapeControlSystem.lua",
	"feature-tilt": "FaceReshapeControlSystem.lua",
	smile: "FaceReshapeControlSystem.lua",
};

function requiredPackageFiles({
	runtimePackage,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}): string[] {
	if (runtimePackage === "skin-tone") {
		return [
			"algorithmConfig.json",
			"config.json",
			"AmazingFeature/main.scene",
			"AmazingFeature/lua/EffectFaceMakeup.lua",
			"AmazingFeature/material/skinSeg.material",
			...[
				"filter_skin",
				"filter_bg",
				"temperature_min",
				"temperature_max",
				"mask",
			].map((name) => `AmazingFeature/image/${name}.png`),
		];
	}
	if (runtimePackage === "small-face") {
		return [
			"algorithmConfig.json",
			"config.json",
			"AmazingFeature/main.scene",
			"AmazingFeature/lua/reshape.lua",
		];
	}
	if (runtimePackage === "jawline") {
		return [
			"algorithmConfig.json",
			"config.json",
			"AmazingFeature/main.scene",
			"AmazingFeature/lua/FaceWarpXControl.lua",
			"AmazingFeature_shadow/main.scene",
			"AmazingFeature_shadow/lua/makeup.lua",
		];
	}
	const script = PACKAGE_SCRIPTS[runtimePackage];
	if (!script) return ["algorithmConfig.json"];
	return [
		"algorithmConfig.json",
		"config.json",
		"AmazingFeature/main.scene",
		`AmazingFeature/lua/${script}`,
	];
}

export async function resolveJianyingPortraitPackage({
	runtimePackage,
	skinToneResourceId,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	skinToneResourceId?: MediaPortraitSkinToneResourceId;
}): Promise<JianyingPortraitPackageResolution> {
	const legacyIdentity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
	const selectedId =
		runtimePackage === "skin-tone"
			? parsePortraitSkinToneResourceId({ value: skinToneResourceId })
			: undefined;
	const selected = JIANYING_PORTRAIT_SKIN_TONES.find(
		({ resourceId }) => resourceId === selectedId
	);
	const identities = selected
		? [
				...(selected.resourceId === legacyIdentity.resourceId
					? [legacyIdentity]
					: []),
				{ ...selected, group: "face" as const },
			]
		: [legacyIdentity];
	const candidates = identities.flatMap((identity) => {
		const privateCandidate = {
			packagePath: path.join(
				jianyingFilterPrivateRuntimeCurrent(),
				"Cache",
				"effect",
				identity.resourceId,
				identity.version
			),
			source: "qcut-private" as const,
		};
		const installedCandidate = {
			packagePath: path.join(
				installedCacheRoot(),
				"effect",
				identity.resourceId,
				identity.version
			),
			source: "jianying-installation" as const,
		};
		return [
			privateCandidate,
			...(process.env.QCUT_JIANYING_DISABLE_USER_CACHE === "1"
				? []
				: [installedCandidate]),
		];
	});
	for (const candidate of candidates) {
		const requiredFiles = requiredPackageFiles({ runtimePackage });
		if (
			await isReadableDirectory({
				directory: candidate.packagePath,
				requiredFiles,
			})
		) {
			return {
				group: legacyIdentity.group,
				runtimePackage,
				...(selectedId ? { skinToneResourceId: selectedId } : {}),
				...candidate,
			};
		}
	}
	return {
		group: legacyIdentity.group,
		runtimePackage,
		...(selectedId ? { skinToneResourceId: selectedId } : {}),
		packagePath: null,
		source: "none",
	};
}

export async function resolveJianyingPortraitPackages({
	skinToneResourceId,
}: {
	skinToneResourceId?: MediaPortraitSkinToneResourceId;
} = {}) {
	return Promise.all(
		JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map((runtimePackage) =>
			resolveJianyingPortraitPackage({ runtimePackage, skinToneResourceId })
		)
	);
}
