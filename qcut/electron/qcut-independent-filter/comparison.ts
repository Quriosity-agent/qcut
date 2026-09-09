import { readFile } from "node:fs/promises";
import { resolveIndependentFilterHost } from "./bridge.js";
import { release } from "node:os";
import { parseFilterLabRenderLocalEffectRequest } from "../jianying-filter-lab-request.js";
import {
	loadIndependentFogLut,
	resolveIndependentFogLut,
	validateIndependentFilterIdentity,
} from "./assets.js";
import {
	FOG_COMPARISON_MAX_EDGE,
	type FilterComparisonResult,
} from "./comparison-contract.js";
import {
	compareRgba,
	comparisonImage,
	rgbaDigest,
} from "./comparison-images.js";
import { renderFogCpuReference } from "./fog-cpu-reference.js";
import { createIndependentFilterSession } from "./session.js";

export function parseFogComparison({ request }: { request: unknown }) {
	const parsed = parseFilterLabRenderLocalEffectRequest({ request });
	if (
		!request ||
		typeof request !== "object" ||
		!("version" in request) ||
		typeof request.version !== "string"
	) {
		throw new Error("对照需要精确的滤镜版本。");
	}
	validateIndependentFilterIdentity({
		resourceId: parsed.resourceId,
		version: request.version,
	});
	if (
		parsed.width > FOG_COMPARISON_MAX_EDGE ||
		parsed.height > FOG_COMPARISON_MAX_EDGE
	) {
		throw new Error(`对照图像的长边不能超过 ${FOG_COMPARISON_MAX_EDGE} 像素。`);
	}
	const rgba = new Uint8Array(parsed.rgba);
	for (let index = 3; index < rgba.length; index += 4) {
		if (rgba[index] !== 255)
			throw new Error("迷雾 C++ 对照目前只支持不透明 SDR 图像。");
	}
	return { ...parsed, version: request.version, rgba };
}

export function createFogComparison() {
	let busy = false;
	return async ({
		request,
	}: {
		request: unknown;
	}): Promise<FilterComparisonResult> => {
		const input = parseFogComparison({ request });
		if (busy) throw new Error("滤镜对照正在运行，请等待完成后重试。");
		if (process.platform !== "darwin")
			throw new Error("滤镜对照目前需要 macOS。");
		busy = true;
		try {
			const lutPath = await resolveIndependentFogLut();
			const candidateBinarySha256 = rgbaDigest({
				rgba: await readFile(await resolveIndependentFilterHost()),
			});
			const lut = await loadIndependentFogLut({ filePath: lutPath });
			const session = await createIndependentFilterSession({ lutPath });
			try {
				// Wait for both workers before disposing the renderer or releasing the single-job gate.
				const results = await Promise.allSettled([
					session.render(input),
					renderFogCpuReference({ request: input, lut }),
				]);
				const [candidate, reference] = results;
				if (candidate.status === "rejected") throw candidate.reason;
				if (reference.status === "rejected") throw reference.reason;
				if (
					candidate.value.width !== input.width ||
					candidate.value.height !== input.height ||
					candidate.value.provider !== "qcut-metal-fog-v1"
				)
					throw new Error("Metal 对照输出身份或尺寸不一致。");
				const measured = compareRgba({
					candidate: candidate.value.rgba,
					reference: reference.value.rgba,
				});
				const picture = ({ name, rgba }: { name: string; rgba: Uint8Array }) =>
					comparisonImage({
						name,
						rgba,
						width: input.width,
						height: input.height,
					});
				return {
					schemaVersion: 1,
					createdAt: new Date().toISOString(),
					resourceId: input.resourceId,
					version: input.version,
					width: input.width,
					height: input.height,
					intensity: input.intensity,
					candidateProvider: "qcut-metal-fog-v1",
					referenceProvider: "qcut-cpp-fog-v1",
					candidateBinarySha256,
					referenceBinarySha256: reference.value.binarySha256,
					lutRgbaSha256: rgbaDigest({ rgba: lut }),
					platform: `${process.platform}/${process.arch}/${release()}`,
					metrics: measured.metrics,
					differenceGain: measured.differenceGain,
					input: picture({ name: "input", rgba: input.rgba }),
					candidate: picture({
						name: "qcut-metal",
						rgba: candidate.value.rgba,
					}),
					reference: picture({
						name: "cpp-reference",
						rgba: reference.value.rgba,
					}),
					difference: picture({
						name: "difference",
						rgba: measured.difference,
					}),
					referenceStages: reference.value.stages.map(picture),
				};
			} finally {
				await session.dispose();
			}
		} finally {
			busy = false;
		}
	};
}
