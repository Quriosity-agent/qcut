import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-contract.js";

export const BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL =
	"beauty-lab:inspect-candidate";
export const BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL =
	"beauty-lab:render-candidate";
export const BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL =
	"beauty-lab:cancel-candidate";
export const BEAUTY_LAB_CANDIDATE_PROTOCOL = "qcut-beauty-lab-candidate-v1";
export const BEAUTY_LAB_CANDIDATE_BACKEND = "qcut-portrait-onnx-candidate-v1";

export const BEAUTY_LAB_CANDIDATE_STAGES = [
	"detection",
	"geometry",
	"sampling-160",
	"inference-160",
	"sampling-120",
	"inference-120",
	"decode",
	"temporal-smoothing",
	"coordinate-mapping",
	"effect-rendering",
] as const;

export type BeautyLabCandidateStageId =
	(typeof BEAUTY_LAB_CANDIDATE_STAGES)[number];

export interface BeautyLabCandidateStage {
	id: BeautyLabCandidateStageId;
	implementation: "qcut" | "native";
	parity: "accepted" | "unverified" | "blocked";
	message: string;
}

export interface BeautyLabCandidateStatus {
	protocol: typeof BEAUTY_LAB_CANDIDATE_PROTOCOL;
	backendId: typeof BEAUTY_LAB_CANDIDATE_BACKEND;
	backendVersion: string | null;
	state: "not-connected" | "blocked" | "ready";
	available: boolean;
	blockers: string[];
	stages: BeautyLabCandidateStage[];
	scope?: "audited-single-static-frame";
	timingScope?: "cumulative-owned-worker-including-warmup";
}

export interface BeautyLabCandidateRequest {
	protocol: typeof BEAUTY_LAB_CANDIDATE_PROTOCOL;
	requestId: string;
	backendVersion: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	adjustments: MediaPortraitAdjustments;
	sourceKey: string;
	frameNumber: number;
	timestampSeconds: number;
}

export type BeautyLabCandidateStageMetric =
	| {
			id: BeautyLabCandidateStageId;
			durationMs: number;
			unavailableReason?: never;
	  }
	| {
			id: BeautyLabCandidateStageId;
			durationMs: null;
			unavailableReason: "native-stage-not-instrumented";
	  };

export interface BeautyLabCandidateResult {
	protocol: typeof BEAUTY_LAB_CANDIDATE_PROTOCOL;
	source: "live-candidate";
	backendId: typeof BEAUTY_LAB_CANDIDATE_BACKEND;
	backendVersion: string;
	requestId: string;
	requestFingerprint: string;
	inputSha256: string;
	sourceKey: string;
	frameNumber: number;
	timestampSeconds: number;
	width: number;
	height: number;
	rgba: Uint8Array;
	nativeDependencies: BeautyLabCandidateStageId[];
	stageMetrics: BeautyLabCandidateStageMetric[];
	scope?: "audited-single-static-frame";
	timingScope?: "cumulative-owned-worker-including-warmup";
	provenance?: {
		auditSha256: string;
		dependenciesSha256: string;
		workerLogSha256: string;
		workerBackendVersion: string;
	};
}

export interface BeautyLabCandidateCancelRequest {
	requestId: string;
}

export interface BeautyLabCandidateCancelResult {
	// False when that request is no longer the one running; nothing was aborted.
	cancelled: boolean;
}

export interface BeautyLabCandidateAPI {
	inspectCandidate: () => Promise<BeautyLabCandidateStatus>;
	renderCandidate: (
		request: BeautyLabCandidateRequest
	) => Promise<BeautyLabCandidateResult>;
	// The render promise still settles; inspect afterwards for any restart blocker.
	cancelCandidate?: (
		request: BeautyLabCandidateCancelRequest
	) => Promise<BeautyLabCandidateCancelResult>;
}
