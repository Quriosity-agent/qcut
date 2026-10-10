import type { JianyingFontLabAPI } from "../../../../../electron/jianying-font/jianying-font-lab-contract";

export interface ElectronJianyingFontLabOps {
	jianyingFontLab?: JianyingFontLabAPI;
}

export type {
	JianyingFontFormat,
	JianyingFontLabAPI,
	JianyingFontLabFontSummary,
	JianyingFontLabInspectRequest,
	JianyingFontLabInspectResult,
	JianyingFontLabListRequest,
	JianyingFontLabListResult,
	JianyingFontLabLoadRequest,
	JianyingFontLabLoadResult,
	JianyingFontLabMissingGlyph,
	JianyingFontSourceKind,
} from "../../../../../electron/jianying-font/jianying-font-lab-contract";
