import { describe, it, expect, beforeEach } from "vitest";
import {
	CharacterBibleManager,
	getCharacterBibleManager,
	generateConsistencyPrompt,
	mergeCharacterAnalyses,
} from "../character-bible";
import type { CharacterBible, CharacterType } from "../types";

/**
 * Helper to create character input data with sensible defaults.
 * Returns the shape expected by CharacterBibleManager.addCharacter()
 * (i.e. without id, createdAt, updatedAt).
 */
const makeCharacter = (
	overrides: Record<string, unknown> = {}
): Omit<CharacterBible, "id" | "createdAt" | "updatedAt"> => ({
	screenplayId: "sp_1",
	name: "Test Character",
	type: "protagonist" as CharacterType,
	visualTraits: "tall, dark hair",
	styleTokens: ["hero", "warrior"],
	colorPalette: ["#FF0000", "#0000FF"],
	personality: "brave and kind",
	referenceImages: [],
	...overrides,
});

/**
 * Helper to build a full CharacterBible object (including id and timestamps).
 * Useful for functions that require the complete type.
 */
const makeFullCharacter = (
	overrides: Record<string, unknown> = {}
): CharacterBible => ({
	id: "char_test_1",
	screenplayId: "sp_1",
	name: "Test Character",
	type: "protagonist" as CharacterType,
	visualTraits: "tall, dark hair",
	styleTokens: ["hero", "warrior"],
	colorPalette: ["#FF0000", "#0000FF"],
	personality: "brave and kind",
	referenceImages: [],
	createdAt: 1000,
	updatedAt: 1000,
	...overrides,
});

describe("CharacterBibleManager", () => {
	let manager: CharacterBibleManager;

	beforeEach(() => {
		manager = new CharacterBibleManager();
	});

	describe("addCharacter()", () => {
		it("creates a character with generated ID and timestamps", () => {
			const before = Date.now();
			const result = manager.addCharacter(makeCharacter());
			const after = Date.now();

			expect(result.id).toBeDefined();
			expect(result.id).toMatch(/^char_/);
			expect(result.createdAt).toBeGreaterThanOrEqual(before);
			expect(result.createdAt).toBeLessThanOrEqual(after);
			expect(result.updatedAt).toBe(result.createdAt);
		});

		it("stores character retrievable by ID", () => {
			const added = manager.addCharacter(makeCharacter());
			const retrieved = manager.getCharacter(added.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved).toEqual(added);
		});
	});

	describe("getCharacter()", () => {
		it("returns null for unknown ID", () => {
			const result = manager.getCharacter("nonexistent_id");
			expect(result).toBeNull();
		});
	});

	describe("updateCharacter()", () => {
		it("updates fields while preserving others", () => {
			const added = manager.addCharacter(makeCharacter());
			const updated = manager.updateCharacter(added.id, {
				name: "Updated Name",
			});

			if (!updated) throw new Error("Expected updated character");
			expect(updated.name).toBe("Updated Name");
			expect(updated.visualTraits).toBe("tall, dark hair");
			expect(updated.screenplayId).toBe("sp_1");
			expect(updated.styleTokens).toEqual(["hero", "warrior"]);
		});

		it("updates the updatedAt timestamp", () => {
			const added = manager.addCharacter(makeCharacter());
			const originalUpdatedAt = added.updatedAt;

			// Small delay to ensure timestamp difference
			const updated = manager.updateCharacter(added.id, {
				name: "New Name",
			});

			if (!updated) throw new Error("Expected updated character");
			expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
			expect(updated.createdAt).toBe(added.createdAt);
		});

		it("returns null for unknown ID", () => {
			const result = manager.updateCharacter("nonexistent_id", {
				name: "New",
			});
			expect(result).toBeNull();
		});

		it("preserves the original id and createdAt even if overrides are passed", () => {
			const added = manager.addCharacter(makeCharacter());
			const updated = manager.updateCharacter(added.id, {
				id: "hacked_id",
				createdAt: 0,
			});

			if (!updated) throw new Error("Expected updated character");
			expect(updated.id).toBe(added.id);
			expect(updated.createdAt).toBe(added.createdAt);
		});
	});

	describe("getCharactersForScreenplay()", () => {
		it("filters by screenplayId", () => {
			manager.addCharacter(makeCharacter({ screenplayId: "sp_1" }));
			manager.addCharacter(makeCharacter({ screenplayId: "sp_1" }));
			manager.addCharacter(makeCharacter({ screenplayId: "sp_2" }));

			const sp1Chars = manager.getCharactersForScreenplay("sp_1");
			const sp2Chars = manager.getCharactersForScreenplay("sp_2");

			expect(sp1Chars).toHaveLength(2);
			expect(sp2Chars).toHaveLength(1);

			for (const c of sp1Chars) {
				expect(c.screenplayId).toBe("sp_1");
			}
			for (const c of sp2Chars) {
				expect(c.screenplayId).toBe("sp_2");
			}
		});

		it("returns empty array for unknown screenplayId", () => {
			manager.addCharacter(makeCharacter({ screenplayId: "sp_1" }));
			const result = manager.getCharactersForScreenplay("sp_unknown");
			expect(result).toEqual([]);
		});
	});

	describe("deleteCharacter()", () => {
		it("removes character", () => {
			const added = manager.addCharacter(makeCharacter());
			expect(manager.getCharacter(added.id)).not.toBeNull();

			const result = manager.deleteCharacter(added.id);
			expect(result).toBe(true);
			expect(manager.getCharacter(added.id)).toBeNull();
		});

		it("returns false for unknown ID", () => {
			const result = manager.deleteCharacter("nonexistent_id");
			expect(result).toBe(false);
		});
	});

	describe("buildCharacterPrompt()", () => {
		it("returns formatted prompt string with character details", () => {
			const char1 = manager.addCharacter(
				makeCharacter({ name: "Hero", visualTraits: "tall, muscular" })
			);
			const char2 = manager.addCharacter(
				makeCharacter({ name: "Villain", visualTraits: "pale, scarred" })
			);

			const prompt = manager.buildCharacterPrompt([char1.id, char2.id]);
			expect(prompt).toBe("[Hero]: tall, muscular; [Villain]: pale, scarred");
		});

		it("returns empty string for unknown IDs", () => {
			const prompt = manager.buildCharacterPrompt(["unknown_1", "unknown_2"]);
			expect(prompt).toBe("");
		});

		it("skips unknown IDs and includes valid ones", () => {
			const char1 = manager.addCharacter(
				makeCharacter({ name: "Hero", visualTraits: "tall" })
			);
			const prompt = manager.buildCharacterPrompt([char1.id, "unknown_id"]);
			expect(prompt).toBe("[Hero]: tall");
		});
	});

	describe("buildStyleTokens()", () => {
		it("returns unique style tokens as array", () => {
			const char1 = manager.addCharacter(
				makeCharacter({ styleTokens: ["hero", "warrior"] })
			);
			const char2 = manager.addCharacter(
				makeCharacter({ styleTokens: ["warrior", "mage"] })
			);

			const tokens = manager.buildStyleTokens([char1.id, char2.id]);
			expect(tokens).toContain("hero");
			expect(tokens).toContain("warrior");
			expect(tokens).toContain("mage");
			expect(tokens).toHaveLength(3);
		});

		it("returns empty array for unknown IDs", () => {
			const tokens = manager.buildStyleTokens(["unknown_1", "unknown_2"]);
			expect(tokens).toEqual([]);
		});
	});

	describe("createFromAnalysis()", () => {
		it("creates character from analysis result", () => {
			const analysis: Record<string, unknown> = {
				name: "Detected Hero",
				type: "protagonist",
				visualTraits: "blue eyes, blond hair",
				styleTokens: ["anime", "shonen"],
				colorPalette: ["#FFFFFF", "#000000"],
				personality: "determined",
			};

			const character = manager.createFromAnalysis(
				"sp_1",
				analysis,
				"https://example.com/ref.png"
			);

			expect(character.name).toBe("Detected Hero");
			expect(character.type).toBe("protagonist");
			expect(character.visualTraits).toBe("blue eyes, blond hair");
			expect(character.styleTokens).toEqual(["anime", "shonen"]);
			expect(character.colorPalette).toEqual(["#FFFFFF", "#000000"]);
			expect(character.personality).toBe("determined");
			expect(character.screenplayId).toBe("sp_1");
			expect(character.referenceImages).toHaveLength(1);
			expect(character.referenceImages[0].url).toBe(
				"https://example.com/ref.png"
			);
			expect(character.referenceImages[0].isPrimary).toBe(true);
			expect(character.id).toMatch(/^char_/);

			// Should be retrievable
			expect(manager.getCharacter(character.id)).toEqual(character);
		});

		it("handles missing fields with defaults", () => {
			const analysis: Record<string, unknown> = {};

			const character = manager.createFromAnalysis("sp_1", analysis);

			expect(character.name).toBe("Unknown");
			expect(character.type).toBe("other");
			expect(character.visualTraits).toBe("");
			expect(character.styleTokens).toEqual([]);
			expect(character.colorPalette).toEqual([]);
			expect(character.personality).toBe("");
			expect(character.referenceImages).toEqual([]);
		});
	});

	describe("exportAll()", () => {
		it("exports all characters as array", () => {
			const char1 = manager.addCharacter(
				makeCharacter({ name: "Character A" })
			);
			const char2 = manager.addCharacter(
				makeCharacter({ name: "Character B" })
			);

			const exported = manager.exportAll();
			expect(exported).toHaveLength(2);
			expect(exported).toContainEqual(char1);
			expect(exported).toContainEqual(char2);
		});

		it("returns empty array when no characters exist", () => {
			const exported = manager.exportAll();
			expect(exported).toEqual([]);
		});
	});

	describe("importAll()", () => {
		it("imports characters and makes them retrievable", () => {
			const characters: CharacterBible[] = [
				makeFullCharacter({ id: "char_import_1", name: "Imported A" }),
				makeFullCharacter({ id: "char_import_2", name: "Imported B" }),
			];

			manager.importAll(characters);

			expect(manager.getCharacter("char_import_1")).not.toBeNull();
			expect(manager.getCharacter("char_import_1")!.name).toBe("Imported A");
			expect(manager.getCharacter("char_import_2")).not.toBeNull();
			expect(manager.getCharacter("char_import_2")!.name).toBe("Imported B");
		});

		it("clears existing characters before importing", () => {
			manager.addCharacter(makeCharacter({ name: "Existing" }));
			expect(manager.exportAll()).toHaveLength(1);

			const characters: CharacterBible[] = [
				makeFullCharacter({ id: "char_new", name: "New" }),
			];

			manager.importAll(characters);
			expect(manager.exportAll()).toHaveLength(1);
			expect(manager.exportAll()[0].name).toBe("New");
		});
	});

	describe("clear()", () => {
		it("removes all characters", () => {
			manager.addCharacter(makeCharacter({ name: "A" }));
			manager.addCharacter(makeCharacter({ name: "B" }));
			manager.addCharacter(makeCharacter({ name: "C" }));
			expect(manager.exportAll()).toHaveLength(3);

			manager.clear();
			expect(manager.exportAll()).toEqual([]);
		});
	});
});

describe("getCharacterBibleManager (singleton)", () => {
	it("returns same instance on multiple calls", () => {
		const instance1 = getCharacterBibleManager();
		const instance2 = getCharacterBibleManager();
		expect(instance1).toBe(instance2);
	});
});

describe("generateConsistencyPrompt", () => {
	it("returns formatted prompt with character details", () => {
		const character = makeFullCharacter({
			name: "Hero",
			visualTraits: "tall, muscular, blue eyes",
			styleTokens: ["cinematic", "dramatic"],
		});

		const prompt = generateConsistencyPrompt(character);

		expect(prompt).toContain("tall, muscular, blue eyes");
		expect(prompt).toContain("cinematic, dramatic");
		expect(prompt).toContain("character: Hero");
	});

	it("includes visual traits, style tokens, and character name", () => {
		const character = makeFullCharacter({
			name: "Villain",
			visualTraits: "scarred face, dark cloak",
			styleTokens: ["noir", "gothic"],
			colorPalette: ["#000000", "#800000"],
		});

		const prompt = generateConsistencyPrompt(character);

		expect(prompt).toBe(
			"scarred face, dark cloak, noir, gothic, character: Villain"
		);
	});

	it("handles characters with no style tokens", () => {
		const character = makeFullCharacter({
			name: "Simple",
			visualTraits: "average build",
			styleTokens: [],
		});

		const prompt = generateConsistencyPrompt(character);

		expect(prompt).toBe("average build, character: Simple");
		expect(prompt).not.toContain(",,");
	});

	it("handles characters with empty visual traits", () => {
		const character = makeFullCharacter({
			name: "Minimal",
			visualTraits: "",
			styleTokens: ["sketch"],
		});

		const prompt = generateConsistencyPrompt(character);

		expect(prompt).toBe("sketch, character: Minimal");
	});
});

describe("mergeCharacterAnalyses", () => {
	it("returns empty object for empty array", () => {
		const result = mergeCharacterAnalyses([]);
		expect(result).toEqual({});
	});

	it("merges single analysis correctly", () => {
		const analysis: Record<string, unknown> = {
			visualTraits: "tall, dark hair",
			styleTokens: ["hero"],
			colorPalette: ["#FF0000"],
			personality: "brave",
		};

		const result = mergeCharacterAnalyses([analysis]);

		expect(result.visualTraits).toBe("tall, dark hair");
		expect(result.styleTokens).toEqual(["hero"]);
		expect(result.colorPalette).toEqual(["#FF0000"]);
		expect(result.personality).toBe("brave");
	});

	it("merges multiple analyses taking longest visual traits", () => {
		const analysis1: Record<string, unknown> = {
			visualTraits: "short description",
			styleTokens: ["token_a"],
			colorPalette: ["#FF0000"],
			personality: "brave",
		};
		const analysis2: Record<string, unknown> = {
			visualTraits: "much longer and more detailed visual trait description",
			styleTokens: ["token_b", "token_c"],
			colorPalette: ["#0000FF", "#00FF00"],
			personality: "",
		};

		const result = mergeCharacterAnalyses([analysis1, analysis2]);

		// Takes the longest visual traits
		expect(result.visualTraits).toBe(
			"much longer and more detailed visual trait description"
		);

		// Merges style tokens (unique set)
		expect(result.styleTokens).toContain("token_a");
		expect(result.styleTokens).toContain("token_b");
		expect(result.styleTokens).toContain("token_c");

		// Merges color palettes (unique set)
		expect(result.colorPalette).toContain("#FF0000");
		expect(result.colorPalette).toContain("#0000FF");
		expect(result.colorPalette).toContain("#00FF00");

		// Takes first non-empty personality
		expect(result.personality).toBe("brave");
	});

	it("deduplicates style tokens across analyses", () => {
		const analysis1: Record<string, unknown> = {
			styleTokens: ["shared", "unique_a"],
		};
		const analysis2: Record<string, unknown> = {
			styleTokens: ["shared", "unique_b"],
		};

		const result = mergeCharacterAnalyses([analysis1, analysis2]);

		expect(result.styleTokens).toHaveLength(3);
		expect(result.styleTokens).toContain("shared");
		expect(result.styleTokens).toContain("unique_a");
		expect(result.styleTokens).toContain("unique_b");
	});

	it("deduplicates color palette entries across analyses", () => {
		const analysis1: Record<string, unknown> = {
			colorPalette: ["#FF0000", "#00FF00"],
		};
		const analysis2: Record<string, unknown> = {
			colorPalette: ["#FF0000", "#0000FF"],
		};

		const result = mergeCharacterAnalyses([analysis1, analysis2]);

		expect(result.colorPalette).toHaveLength(3);
		expect(result.colorPalette).toContain("#FF0000");
		expect(result.colorPalette).toContain("#00FF00");
		expect(result.colorPalette).toContain("#0000FF");
	});

	it("handles analyses with missing optional fields", () => {
		const analysis1: Record<string, unknown> = {
			visualTraits: "some traits",
		};
		const analysis2: Record<string, unknown> = {
			personality: "cheerful",
		};

		const result = mergeCharacterAnalyses([analysis1, analysis2]);

		expect(result.visualTraits).toBe("some traits");
		expect(result.personality).toBe("cheerful");
		expect(result.styleTokens).toEqual([]);
		expect(result.colorPalette).toEqual([]);
	});
});
