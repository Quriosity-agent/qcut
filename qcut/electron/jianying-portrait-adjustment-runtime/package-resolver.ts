import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	JianyingPortraitAdjustmentGroup,
	JianyingPortraitAdjustmentRuntimePackage,
} from "../jianying-portrait-adjustment-contract.js";
import { jianyingFilterPrivateRuntimeCurrent } from "../jianying-filter-local-runtime/private-runtime.js";
import {
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "./catalog.js";

export interface JianyingPortraitPackageResolution {
	group: JianyingPortraitAdjustmentGroup;
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	packagePath: string | null;
	source: "qcut-private" | "jianying-installation" | "none";
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

function requiredPackageFiles({
	runtimePackage,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}): string[] {
	const script =
		runtimePackage === "nose-3d"
			? "Face3DSystem.lua"
			: runtimePackage === "feature-tilt" || runtimePackage === "smile"
				? "FaceReshapeControlSystem.lua"
				: null;
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
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}): Promise<JianyingPortraitPackageResolution> {
	const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
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
	const candidates = [
		privateCandidate,
		...(process.env.QCUT_JIANYING_DISABLE_USER_CACHE === "1"
			? []
			: [installedCandidate]),
	];
	for (const candidate of candidates) {
		const requiredFiles = requiredPackageFiles({ runtimePackage });
		if (
			await isReadableDirectory({
				directory: candidate.packagePath,
				requiredFiles,
			})
		) {
			return {
				group: identity.group,
				runtimePackage,
				...candidate,
			};
		}
	}
	return {
		group: identity.group,
		runtimePackage,
		packagePath: null,
		source: "none",
	};
}

export async function resolveJianyingPortraitPackages() {
	return Promise.all(
		JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map((runtimePackage) =>
			resolveJianyingPortraitPackage({ runtimePackage })
		)
	);
}
