/**
 * Types for Character Calibrator modules.
 * Extracted to break circular dependency between character-calibrator and character-calibrator-enrichment.
 */

import type {
	CharacterIdentityAnchors,
	CharacterNegativePrompt,
} from "@/types/moyin-script";

export interface CalibratedCharacter {
	id: string;
	name: string;
	importance: "protagonist" | "supporting" | "minor" | "extra";
	episodeRange?: [number, number];
	appearanceCount: number;
	role?: string;
	age?: string;
	gender?: string;
	relationships?: string;
	nameVariants: string[];
	visualPromptEn?: string;
	visualPromptZh?: string;
	facialFeatures?: string;
	uniqueMarks?: string;
	clothingStyle?: string;
	identityAnchors?: CharacterIdentityAnchors;
	negativePrompt?: CharacterNegativePrompt;
}

export interface MergeRecord {
	finalName: string;
	variants: string[];
	reason: string;
}

export interface CharacterCalibrationResult {
	characters: CalibratedCharacter[];
	filteredWords: string[];
	mergeRecords: MergeRecord[];
	analysisNotes: string;
}

export interface CalibrationOptions {
	previousCharacters?: CalibratedCharacter[];
}

export interface CharacterStats {
	name: string;
	sceneCount: number;
	dialogueCount: number;
	episodes: number[];
	firstEpisode: number;
	lastEpisode: number;
	dialogueSamples: string[];
	sceneSamples: string[];
}
