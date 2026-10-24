import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

export const BEAUTY_LAB_INDEPENDENT_INSPECT = "beauty-lab:inspect-independent";
export const BEAUTY_LAB_INDEPENDENT_RENDER = "beauty-lab:render-independent";
export const BEAUTY_LAB_INDEPENDENT_CANCEL = "beauty-lab:cancel-independent";
export const BEAUTY_LAB_INDEPENDENT_RENDER_FRAME =
	"beauty-lab:render-independent-frame";
export const BEAUTY_LAB_INDEPENDENT_RENDER_SEQUENCE_FRAME =
	"beauty-lab:render-independent-sequence-frame";
export const BEAUTY_LAB_INDEPENDENT_PROVIDER = "qcut-independent-photo-v1";
export const INDEPENDENT_BEAUTY_MAX_EDGE = 4096;
export const INDEPENDENT_BEAUTY_MAX_PIXELS = 3840 * 2160;
export const INDEPENDENT_SOURCE_EVIDENCE_POLICY =
	"single-face-bidirectional-v1";
export const INDEPENDENT_SOURCE_EVIDENCE_MAX_BYTES = 64 * 1024 ** 2;
export const INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS = 0.5;

export type BeautyLabIndependentSourceEvidence =
	| {
			policy: typeof INDEPENDENT_SOURCE_EVIDENCE_POLICY;
			status: "available";
			targetTimestampSeconds: number;
			frames: Array<{ timestampSeconds: number; rgba: Uint8Array }>;
	  }
	| {
			policy: typeof INDEPENDENT_SOURCE_EVIDENCE_POLICY;
			status: "unavailable";
			reason: string;
	  };

export interface BeautyLabIndependentStatus {
	available: boolean;
	message: string;
	provider: typeof BEAUTY_LAB_INDEPENDENT_PROVIDER;
	controls: string[];
	makeupCards: string[];
	/** Manual body tools the engine renders, e.g. ["stretch", "slim", "zoom"]; absent: none. */
	manualBodyTools?: string[];
	/** True when the runtime holds the body-video policy the engine pins: clip body edits then follow the clip's history. */
	bodyVideo?: boolean;
	bodyVideoProfiles?: {
		"swing-coreml-v1": {
			available: boolean;
			message: string;
			identitySha256?: string;
		};
	};
}
/** The manual body tools the independent engine renders (editor ranges). */
export interface BeautyLabIndependentManualBody {
	stretch?: { intensity: number; upper: number; bottom: number };
	slim?: {
		intensity: number;
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	};
	zoom?: { intensity: number; x: number; y: number; radius: number };
}
export interface BeautyLabIndependentRequest {
	requestId: string;
	sourceKey: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	sourceEvidence?: BeautyLabIndependentSourceEvidence;
	adjustments: MediaPortraitAdjustments;
}
export interface BeautyLabIndependentResult {
	provider: typeof BEAUTY_LAB_INDEPENDENT_PROVIDER;
	requestId: string;
	sourceKey: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	png: Uint8Array;
	inputSha256: string;
	outputSha256: string;
	report: Record<string, unknown>;
}
/** Content-addressed timeline input; neighbors may resolve ambiguous face detections. */
export interface BeautyLabIndependentFrameRequest {
	requestId: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	sourceEvidence?: BeautyLabIndependentSourceEvidence;
	adjustments: {
		enabled: true;
		values: Record<string, number>;
		makeup?: Record<string, { cardId: string; intensity: number }>;
		manualBody?: BeautyLabIndependentManualBody;
		bodyVideoProfile?: "swing-coreml-v1";
	};
}
export interface BeautyLabIndependentFrameResult {
	requestId: string;
	width: number;
	height: number;
	rgba: Uint8Array;
	/** True when the frame came from the disk cache instead of the engine. */
	cached: boolean;
}
/**
 * One frame of a clip's body-video session. `clip` names the clip's source
 * and timing; `frame` counts the clip's frames from its first at `fps`, and
 * frame k renders after frames 0..k-1 of the same session.
 */
export interface BeautyLabIndependentSequence {
	clip: string;
	frame: number;
	fps: number;
	/** CoreML's graph clock follows decoded source PTS, including repeated samples. */
	sourceTimestampSeconds?: number;
	/** Rebuilds history after a "replay" result: the cache is skipped so the engine advances. */
	replay: boolean;
}
export interface BeautyLabIndependentSequenceFrameRequest
	extends Omit<BeautyLabIndependentFrameRequest, "sourceEvidence"> {
	sequence: BeautyLabIndependentSequence;
}
export type BeautyLabIndependentSequenceFrameResult =
	| (BeautyLabIndependentFrameResult & { status: "rendered" })
	| {
			status: "replay";
			requestId: string;
			/** Submit frames `from`..frame-1 with `replay`, then ask for the frame again. */
			from: number;
	  };
export interface BeautyLabIndependentAPI {
	inspectIndependent?: () => Promise<BeautyLabIndependentStatus>;
	renderIndependent?: (
		request: BeautyLabIndependentRequest
	) => Promise<BeautyLabIndependentResult>;
	cancelIndependent?: (request: {
		requestId: string;
	}) => Promise<{ cancelled: boolean }>;
	renderIndependentFrame?: (
		request: BeautyLabIndependentFrameRequest
	) => Promise<BeautyLabIndependentFrameResult>;
	renderIndependentSequenceFrame?: (
		request: BeautyLabIndependentSequenceFrameRequest
	) => Promise<BeautyLabIndependentSequenceFrameResult>;
}
