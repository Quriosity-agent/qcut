import type { IndependentFilterRequest } from "./contract.js";

export const QCUT_FILTER_COMPARE = "qcut-independent-filter:compare";
export const FOG_COMPARISON_MAX_EDGE = 640;
export const FOG_COMPARISON_STAGES = [
	"00-input",
	"01-blur-x",
	"02-blur-y",
	"03-fog",
	"04-lut",
] as const;

export interface FilterComparisonMetrics {
	rgbMae: number;
	rgbRmse: number;
	rgbMax: number;
	alphaMax: number;
	changedPixels: number;
	pixelCount: number;
}

export interface FilterComparisonImage {
	name: string;
	png: string;
	sha256: string;
}

export interface FilterComparisonResult {
	schemaVersion: 1;
	createdAt: string;
	resourceId: string;
	version: string;
	width: number;
	height: number;
	intensity: number;
	candidateProvider: "qcut-metal-fog-v1";
	referenceProvider: "qcut-cpp-fog-v1";
	candidateBinarySha256: string;
	referenceBinarySha256: string;
	lutRgbaSha256: string;
	platform: string;
	metrics: FilterComparisonMetrics;
	differenceGain: number;
	input: FilterComparisonImage;
	candidate: FilterComparisonImage;
	reference: FilterComparisonImage;
	difference: FilterComparisonImage;
	referenceStages: FilterComparisonImage[];
}

export interface FilterComparisonAPI {
	compare: (
		request: IndependentFilterRequest
	) => Promise<FilterComparisonResult>;
}
