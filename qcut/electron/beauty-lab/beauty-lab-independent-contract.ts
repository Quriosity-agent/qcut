import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

export const BEAUTY_LAB_INDEPENDENT_INSPECT = "beauty-lab:inspect-independent";
export const BEAUTY_LAB_INDEPENDENT_RENDER = "beauty-lab:render-independent";
export const BEAUTY_LAB_INDEPENDENT_CANCEL = "beauty-lab:cancel-independent";
export const BEAUTY_LAB_INDEPENDENT_RENDER_FRAME =
	"beauty-lab:render-independent-frame";
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
	/** Manual body tools the engine renders, e.g. ["stretch"]; absent: none. */
	manualBodyTools?: string[];
}
/** The stretch band the independent engine renders (editor ranges). */
export interface BeautyLabIndependentManualBody {
	stretch?: { intensity: number; upper: number; bottom: number };
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
}
