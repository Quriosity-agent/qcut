/**
 * Character Bible Manager
 * Handles character storage and consistency across scenes.
 * Ported from moyin-creator ai-core/services/character-bible.ts
 */

import type { CharacterBible, ReferenceImage } from "./types";

/**
 * Character Bible Manager — in-memory storage with CRUD operations.
 * Used for maintaining character visual consistency in AI generation.
 */
export class CharacterBibleManager {
	private characters: Map<string, CharacterBible> = new Map();

	/** Add a new character */
	addCharacter(
		character: Omit<CharacterBible, "id" | "createdAt" | "updatedAt">,
	): CharacterBible {
		const id = `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = Date.now();

		const newCharacter: CharacterBible = {
			...character,
			id,
			createdAt: now,
			updatedAt: now,
		};

		this.characters.set(id, newCharacter);
		return newCharacter;
	}

	/** Update character */
	updateCharacter(
		id: string,
		updates: Partial<CharacterBible>,
	): CharacterBible | null {
		const existing = this.characters.get(id);
		if (!existing) return null;

		const updated: CharacterBible = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};

		this.characters.set(id, updated);
		return updated;
	}

	/** Get character by ID */
	getCharacter(id: string): CharacterBible | null {
		return this.characters.get(id) || null;
	}

	/** Get all characters for a screenplay */
	getCharactersForScreenplay(screenplayId: string): CharacterBible[] {
		return Array.from(this.characters.values()).filter(
			(c) => c.screenplayId === screenplayId,
		);
	}

	/** Delete character */
	deleteCharacter(id: string): boolean {
		return this.characters.delete(id);
	}

	/**
	 * Build character prompt string for scene generation.
	 * Combines visual traits from selected characters.
	 */
	buildCharacterPrompt(characterIds: string[]): string {
		const characters = characterIds
			.map((id) => this.characters.get(id))
			.filter((c): c is CharacterBible => c !== undefined);

		if (characters.length === 0) return "";

		return characters.map((c) => `[${c.name}]: ${c.visualTraits}`).join("; ");
	}

	/** Build unique style tokens from characters */
	buildStyleTokens(characterIds: string[]): string[] {
		const characters = characterIds
			.map((id) => this.characters.get(id))
			.filter((c): c is CharacterBible => c !== undefined);

		const tokenSet = new Set<string>();
		for (const c of characters) {
			for (const token of c.styleTokens) {
				tokenSet.add(token);
			}
		}

		return Array.from(tokenSet);
	}

	/** Create character from analysis result */
	createFromAnalysis(
		screenplayId: string,
		analysisResult: Record<string, unknown>,
		referenceImageUrl?: string,
	): CharacterBible {
		const referenceImages: ReferenceImage[] = [];

		if (referenceImageUrl) {
			referenceImages.push({
				id: `ref_${Date.now()}`,
				url: referenceImageUrl,
				analysisResult,
				isPrimary: true,
			});
		}

		return this.addCharacter({
			screenplayId,
			name: (analysisResult.name as string) || "Unknown",
			type:
				(analysisResult.type as CharacterBible["type"]) || "other",
			visualTraits: (analysisResult.visualTraits as string) || "",
			styleTokens: (analysisResult.styleTokens as string[]) || [],
			colorPalette: (analysisResult.colorPalette as string[]) || [],
			personality: (analysisResult.personality as string) || "",
			referenceImages,
		});
	}

	/** Export all characters for persistence */
	exportAll(): CharacterBible[] {
		return Array.from(this.characters.values());
	}

	/** Import characters from persistence */
	importAll(characters: CharacterBible[]): void {
		this.characters.clear();
		for (const c of characters) {
			this.characters.set(c.id, c);
		}
	}

	/** Clear all characters */
	clear(): void {
		this.characters.clear();
	}
}

// Singleton instance
let managerInstance: CharacterBibleManager | null = null;

/** Get the singleton character bible manager */
export function getCharacterBibleManager(): CharacterBibleManager {
	if (!managerInstance) {
		managerInstance = new CharacterBibleManager();
	}
	return managerInstance;
}

/**
 * React hook wrapper for CharacterBibleManager.
 * Returns the singleton instance for use in components.
 */
export function useCharacterBibleManager(): CharacterBibleManager {
	return getCharacterBibleManager();
}

/**
 * Generate a consistency prompt for a character.
 * Used to maintain visual consistency across scenes.
 */
export function generateConsistencyPrompt(character: CharacterBible): string {
	const parts: string[] = [];

	if (character.visualTraits) {
		parts.push(character.visualTraits);
	}

	if (character.styleTokens.length > 0) {
		parts.push(character.styleTokens.join(", "));
	}

	parts.push(`character: ${character.name}`);

	return parts.join(", ");
}

/**
 * Merge multiple character analyses to find common traits.
 * Useful when analyzing multiple reference images of the same character.
 */
export function mergeCharacterAnalyses(
	analyses: Record<string, unknown>[],
): Partial<CharacterBible> {
	if (analyses.length === 0) return {};

	if (analyses.length === 1) {
		return {
			visualTraits: analyses[0].visualTraits as string,
			styleTokens: (analyses[0].styleTokens as string[]) || [],
			colorPalette: (analyses[0].colorPalette as string[]) || [],
			personality: analyses[0].personality as string,
		};
	}

	// Take the longest/most detailed visual traits
	const visualTraits =
		(analyses
			.map((a) => a.visualTraits as string)
			.filter(Boolean)
			.sort((a, b) => b.length - a.length)[0] as string) || "";

	// Merge style tokens (unique)
	const styleTokenSet = new Set<string>();
	for (const a of analyses) {
		if (a.styleTokens) {
			for (const t of a.styleTokens as string[]) {
				styleTokenSet.add(t);
			}
		}
	}

	// Merge color palettes (unique)
	const colorSet = new Set<string>();
	for (const a of analyses) {
		if (a.colorPalette) {
			for (const c of a.colorPalette as string[]) {
				colorSet.add(c);
			}
		}
	}

	return {
		visualTraits,
		styleTokens: Array.from(styleTokenSet),
		colorPalette: Array.from(colorSet),
		personality:
			(analyses.find((a) => a.personality)?.personality as string) || "",
	};
}
