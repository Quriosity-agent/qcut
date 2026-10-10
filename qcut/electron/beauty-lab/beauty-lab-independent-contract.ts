import type { MediaPortraitAdjustments } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

export const BEAUTY_LAB_INDEPENDENT_INSPECT = "beauty-lab:inspect-independent";
export const BEAUTY_LAB_INDEPENDENT_RENDER = "beauty-lab:render-independent";
export const BEAUTY_LAB_INDEPENDENT_CANCEL = "beauty-lab:cancel-independent";
export const BEAUTY_LAB_INDEPENDENT_PROVIDER = "qcut-independent-photo-v1";

export interface BeautyLabIndependentStatus {
	available: boolean;
	message: string;
	provider: typeof BEAUTY_LAB_INDEPENDENT_PROVIDER;
	controls: string[];
	makeupCards: string[];
}
export interface BeautyLabIndependentRequest {
	requestId: string;
	sourceKey: string;
	width: number;
	height: number;
	rgba: Uint8Array;
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
export interface BeautyLabIndependentAPI {
	inspectIndependent?: () => Promise<BeautyLabIndependentStatus>;
	renderIndependent?: (
		request: BeautyLabIndependentRequest
	) => Promise<BeautyLabIndependentResult>;
	cancelIndependent?: (request: {
		requestId: string;
	}) => Promise<{ cancelled: boolean }>;
}
