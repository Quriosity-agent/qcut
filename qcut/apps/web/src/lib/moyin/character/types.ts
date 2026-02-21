/**
 * Character Bible Types
 * Ported from moyin-creator ai-core/services/character-bible.ts
 */

export interface ReferenceImage {
	id: string;
	url: string;
	analysisResult?: unknown;
	isPrimary: boolean;
}

export type CharacterType =
	| "protagonist"
	| "antagonist"
	| "supporting"
	| "other";

export interface CharacterBible {
	id: string;
	screenplayId: string;

	// Basic info
	name: string;
	type: CharacterType;

	// Visual description (for image generation)
	visualTraits: string;

	// Style tokens for consistency
	styleTokens: string[];

	// Color palette
	colorPalette: string[];

	// Personality description
	personality: string;

	// Reference images
	referenceImages: ReferenceImage[];

	// Generated three-view images (for consistency)
	threeViewImages?: {
		front?: string;
		side?: string;
		back?: string;
	};

	// Metadata
	createdAt: number;
	updatedAt: number;
}
