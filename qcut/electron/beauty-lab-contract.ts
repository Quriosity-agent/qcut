import type { MediaPortraitAdjustments } from "./jianying-portrait-adjustment-contract.js";
import type { BeautyLabCandidateAPI } from "./beauty-lab-candidate-contract.js";

export const BEAUTY_LAB_LIST_CHANNEL = "beauty-lab:list-research-cases";
export const BEAUTY_LAB_LOAD_CHANNEL = "beauty-lab:load-research-frame";

export interface BeautyLabResearchCase {
	id: string;
	name: string;
	frameCount: 7;
}

export interface BeautyLabResearchFrame {
	caseId: string;
	frameIndex: number;
	width: number;
	height: number;
	input: Uint8Array;
	native: Uint8Array;
	candidate: Uint8Array;
	adjustments: MediaPortraitAdjustments;
	source: "verified-offline-replay";
	sourceHashesVerified: true;
	nativeDependencies: true;
}

export interface BeautyLabAPI extends BeautyLabCandidateAPI {
	listResearchCases: () => Promise<BeautyLabResearchCase[]>;
	loadResearchFrame: (request: {
		caseId: string;
		frameIndex: number;
	}) => Promise<BeautyLabResearchFrame>;
}
