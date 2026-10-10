import type { BeautyLabAPI } from "../../../../../electron/beauty-lab-contract";

export interface ElectronBeautyLabOps {
	beautyLab?: BeautyLabAPI;
}

export type {
	BeautyLabIndependentRequest,
	BeautyLabIndependentResult,
	BeautyLabIndependentStatus,
} from "../../../../../electron/beauty-lab-independent-contract";
export { BEAUTY_LAB_INDEPENDENT_PROVIDER } from "../../../../../electron/beauty-lab-independent-contract";

export type {
	BeautyLabAPI,
	BeautyLabResearchCase,
	BeautyLabResearchFrame,
} from "../../../../../electron/beauty-lab-contract";

export type {
	BeautyLabCandidateRequest,
	BeautyLabCandidateResult,
	BeautyLabCandidateStage,
	BeautyLabCandidateStageId,
	BeautyLabCandidateStatus,
} from "../../../../../electron/beauty-lab/beauty-lab-candidate-contract";

export {
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_BACKEND,
} from "../../../../../electron/beauty-lab/beauty-lab-candidate-contract";
