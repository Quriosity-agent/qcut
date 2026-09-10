import {
	MediabunnyPlanarFrameSource,
	type PlanarFrameSource,
} from "@/lib/tracking/mediabunny-planar-frame-source";
import { sha256Blob } from "@/lib/tracking/planar-tracking-analyzer";
import { MotionAnalysisClient } from "./motion-analysis-client";
import {
	type FrameMotion,
	type MotionAnalysis,
	STABILIZATION_ANALYSIS_MAX_HEIGHT,
	STABILIZATION_ANALYSIS_MAX_WIDTH,
	STABILIZATION_ANALYSIS_VERSION,
} from "./stabilization-protocol";

export type MotionAnalysisPhase = "hashing" | "analyzing" | "complete";

export interface MotionAnalysisProgress {
	phase: MotionAnalysisPhase;
	progress: number;
	processedFrames: number;
}

export interface AnalyzeMotionOptions {
	file: File;
	/** Skips hashing when the caller already knows the content hash. */
	contentSha256?: string;
	frameSource?: PlanarFrameSource;
	client?: MotionAnalysisClient;
	onProgress?: (progress: MotionAnalysisProgress) => void;
	signal?: AbortSignal;
}

const HASHING_SHARE = 0.08;

/**
 * Decodes every frame of `file` at analysis resolution and estimates the
 * camera motion between consecutive frames. Decoding happens on the calling
 * thread through WebCodecs; estimation runs in the OpenCV worker.
 */
export async function analyzeMotion({
	file,
	contentSha256,
	frameSource = new MediabunnyPlanarFrameSource({
		file,
		maxAnalysisWidth: STABILIZATION_ANALYSIS_MAX_WIDTH,
		maxAnalysisHeight: STABILIZATION_ANALYSIS_MAX_HEIGHT,
	}),
	client = new MotionAnalysisClient(),
	onProgress,
	signal,
}: AnalyzeMotionOptions): Promise<MotionAnalysis> {
	const terminateOnAbort = (): void => client.terminate();
	signal?.addEventListener("abort", terminateOnAbort, { once: true });
	try {
		signal?.throwIfAborted();
		onProgress?.({ phase: "hashing", progress: 0, processedFrames: 0 });
		const hash =
			contentSha256 ??
			(await sha256Blob({
				blob: file,
				signal,
				onProgress: (progress) =>
					onProgress?.({
						phase: "hashing",
						progress: progress * HASHING_SHARE,
						processedFrames: 0,
					}),
			}));
		signal?.throwIfAborted();
		const metadata = await frameSource.metadata();
		await client.initialize();
		const frames: FrameMotion[] = [];
		const span = Math.max(1, metadata.endPtsUs - metadata.firstPtsUs);
		for await (const frame of frameSource.forwardFrames({
			afterPtsUs: metadata.firstPtsUs - 1,
			endPtsUs: metadata.endPtsUs,
			signal,
		})) {
			frames.push(await client.push({ frame }));
			onProgress?.({
				phase: "analyzing",
				progress:
					HASHING_SHARE +
					(1 - HASHING_SHARE) *
						Math.min(1, (frame.ptsUs - metadata.firstPtsUs) / span),
				processedFrames: frames.length,
			});
		}
		if (frames.length === 0) {
			throw new Error("The video has no decodable frames to analyse.");
		}
		onProgress?.({
			phase: "complete",
			progress: 1,
			processedFrames: frames.length,
		});
		return {
			version: STABILIZATION_ANALYSIS_VERSION,
			contentSha256: hash,
			sourceWidth: metadata.sourceDisplayWidth,
			sourceHeight: metadata.sourceDisplayHeight,
			analysisWidth: metadata.analysisWidth,
			analysisHeight: metadata.analysisHeight,
			frames,
		};
	} finally {
		signal?.removeEventListener("abort", terminateOnAbort);
		client.terminate();
		await frameSource.dispose();
	}
}
