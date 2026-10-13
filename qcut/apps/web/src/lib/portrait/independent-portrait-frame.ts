import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	independentPortraitIssueMessage,
	independentPortraitRequest,
} from "./independent-portrait-adjustments";
import { independentPortraitDimensionsValid } from "./portrait-processing-size";
import type { IndependentPortraitSourceEvidenceReader } from "./independent-source-evidence";

/**
 * Engine failures arrive wrapped by IPC around a Python traceback; keep only
 * what the user can act on.
 */
export function independentPortraitErrorMessage({ error }: { error: unknown }) {
	const text = error instanceof Error ? error.message : String(error);
	if (text.includes("unverified skin segmentation profile"))
		return "自研美颜的磨皮、美白暂不支持这个画面比例，可改用原生，或使用 16:9、9:16、3:4 等画布";
	const exceptions = [
		// Tracebacks arrive JSON-escaped, so lines end in a literal "\n".
		...text.matchAll(/(?:^|\s|\\n)([A-Z]\w*(?:Error|Exception)): ([^\\"\n]+)/g),
	];
	const last = exceptions.at(-1);
	if (last) return `自研美颜引擎出错：${last[1]}: ${last[2].trim()}`;
	return text.replace(
		/^Error invoking remote method '[^']+': (?:Error: )?/,
		""
	);
}

/**
 * Processes one timeline frame with the independent portrait engine.
 *
 * There is no native fallback: an unsupported edit, a missing engine or a
 * failed frame throws, and the caller decides whether to show the original
 * (paused preview) or stop (export). Cancelling `signal` stops the engine job.
 */
export async function renderIndependentPortraitFrame({
	source,
	adjustments,
	timestampSeconds,
	readSourceEvidence,
	signal,
}: {
	source: ImageData;
	adjustments: MediaPortraitAdjustments;
	timestampSeconds?: number;
	readSourceEvidence?: IndependentPortraitSourceEvidenceReader;
	signal?: AbortSignal;
}): Promise<ImageData> {
	signal?.throwIfAborted();
	const converted = independentPortraitRequest({ adjustments });
	if ("issue" in converted)
		throw new Error(
			independentPortraitIssueMessage({ issue: converted.issue })
		);
	const { width, height } = source;
	if (!independentPortraitDimensionsValid({ width, height }))
		throw new Error(
			"自研美颜需要有效画面尺寸，最长边不超过 4096，总像素不超过 8294400"
		);
	const api = window.electronAPI?.beautyLab;
	if (!api?.renderIndependentFrame || !api.cancelIndependent)
		throw new Error("自研美颜需要 QCut 桌面版");
	// The engine takes opaque frames; letterboxed preview borders are restored below.
	const rgba = new Uint8Array(source.data);
	for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
	const sourceEvidence =
		readSourceEvidence && timestampSeconds !== undefined
			? await readSourceEvidence({ width, height, timestampSeconds, signal })
			: undefined;
	signal?.throwIfAborted();
	const requestId = `timeline-${crypto.randomUUID()}`;
	const cancel = () => {
		void api.cancelIndependent?.({ requestId }).catch(() => {});
	};
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		const result = await api
			.renderIndependentFrame({
				requestId,
				width,
				height,
				rgba,
				adjustments: converted.adjustments,
				...(sourceEvidence ? { sourceEvidence } : {}),
			})
			.catch((error: unknown) => {
				signal?.throwIfAborted();
				throw new Error(independentPortraitErrorMessage({ error }), {
					cause: error,
				});
			});
		signal?.throwIfAborted();
		if (
			result.requestId !== requestId ||
			result.width !== width ||
			result.height !== height ||
			result.rgba.byteLength !== source.data.byteLength
		)
			throw new Error("自研美颜返回了不匹配的画面");
		const output = Uint8ClampedArray.from(result.rgba);
		for (let index = 3; index < output.length; index += 4)
			output[index] = source.data[index];
		return new ImageData(output, width, height);
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
}
