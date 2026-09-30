import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { JianyingPortraitAdjustmentRuntimePackage } from "../jianying-portrait-adjustment-contract.js";

export function isJianying3DNosePackage({
	runtimePackage,
}: {
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
}): boolean {
	return ["nose-3d", "nose-sculpt", "nose-upturned", "nose-hump"].includes(
		runtimePackage
	);
}

export const JIANYING_NOSE_3D_MODELS = [
	"tt_face",
	"tt_face_extra",
	"tt_fsnew_base_jianying",
	"tt_facefitting1220",
	"tt_freid",
] as const;

export async function missingJianyingNoseModels({
	modelDirectory,
	runtimePackage = "nose-3d",
}: {
	modelDirectory: string | null;
	runtimePackage?: JianyingPortraitAdjustmentRuntimePackage;
}): Promise<string[]> {
	if (!isJianying3DNosePackage({ runtimePackage })) return [];
	const models = JIANYING_NOSE_3D_MODELS.map((model) =>
		model === "tt_facefitting1220" && runtimePackage !== "nose-3d"
			? "tt_facefitting1256"
			: model
	);
	if (!modelDirectory) return models;
	const entries = await readdir(modelDirectory, { withFileTypes: true }).catch(
		() => []
	);
	const present = await Promise.all(
		models.map(async (model) => {
			const candidates = entries.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.startsWith(`${model}_v`) &&
					entry.name.endsWith(".model")
			);
			const sizes = await Promise.all(
				candidates.map(async ({ name }) =>
					stat(path.join(modelDirectory, name))
						.then(({ size }) => size)
						.catch(() => 0)
				)
			);
			return sizes.some((size) => size > 0);
		})
	);
	return models.filter((_, index) => !present[index]);
}
