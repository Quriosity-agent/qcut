import type { BeautyLabAPI } from "../../../../../electron/beauty-lab-contract";

export interface ElectronBeautyLabOps {
	beautyLab?: BeautyLabAPI;
}

export type {
	BeautyLabAPI,
	BeautyLabResearchCase,
	BeautyLabResearchFrame,
} from "../../../../../electron/beauty-lab-contract";
