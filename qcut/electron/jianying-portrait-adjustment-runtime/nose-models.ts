import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const JIANYING_NOSE_3D_MODELS = [
	"tt_face",
	"tt_face_extra",
	"tt_fsnew_base_jianying",
	"tt_facefitting1220",
	"tt_freid",
] as const;

export async function missingJianyingNoseModels({
	modelDirectory,
}: {
	modelDirectory: string | null;
}): Promise<string[]> {
	if (!modelDirectory) return [...JIANYING_NOSE_3D_MODELS];
	const entries = await readdir(modelDirectory, { withFileTypes: true }).catch(
		() => []
	);
	const present = await Promise.all(
		JIANYING_NOSE_3D_MODELS.map(async (model) => {
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
	return JIANYING_NOSE_3D_MODELS.filter((_, index) => !present[index]);
}
