/**
 * Word Timeline Store Tests
 *
 * Tests for the word timeline store functionality including:
 * - Loading JSON data
 * - Toggling word deletion
 * - Word selection
 * - Getting visible/non-deleted words
 *
 * @module stores/__tests__/word-timeline-store.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useWordTimelineStore } from "../word-timeline-store";
import type { RawWordTimelineJson } from "@/types/word-timeline";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockJson(
  overrides?: Partial<RawWordTimelineJson>
): RawWordTimelineJson {
  return {
    text: "Hello world test",
    language_code: "eng",
    language_probability: 0.99,
    words: [
      { text: "Hello", start: 0, end: 0.5, type: "word" },
      { text: " ", start: 0.5, end: 0.6, type: "spacing" },
      { text: "world", start: 0.6, end: 1.0, type: "word" },
      { text: " ", start: 1.0, end: 1.1, type: "spacing" },
      { text: "test", start: 1.1, end: 1.5, type: "word" },
    ],
    ...overrides,
  };
}

/**
 * Helper to load mock data into the store (synchronous alternative to loadFromJson)
 */
function loadMockData(json?: RawWordTimelineJson, fileName?: string) {
  const data = json ?? createMockJson();
  useWordTimelineStore.getState().loadFromData(data, fileName ?? "test.json");
}

// ============================================================================
// Tests
// ============================================================================

describe("WordTimelineStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useWordTimelineStore.getState().clearData();
  });

  // --------------------------------------------------------------------------
  // Loading Tests
  // --------------------------------------------------------------------------

  describe("loadFromData", () => {
    it("should load JSON data", () => {
      loadMockData();

      const state = useWordTimelineStore.getState();
      expect(state.data).not.toBeNull();
      expect(state.data?.words).toHaveLength(5);
      expect(state.fileName).toBe("test.json");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should assign unique IDs to words", () => {
      loadMockData();

      const state = useWordTimelineStore.getState();
      const ids = state.data?.words.map((w) => w.id) || [];

      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length);

      // IDs should follow the expected format
      expect(ids[0]).toBe("word-0");
      expect(ids[1]).toBe("word-1");
    });

    it("should initialize words with deleted=false", () => {
      loadMockData();

      const state = useWordTimelineStore.getState();
      const allNotDeleted = state.data?.words.every((w) => w.deleted === false);

      expect(allNotDeleted).toBe(true);
    });

    it("should handle missing optional fields", () => {
      const mockJson: RawWordTimelineJson = {
        text: "Test",
        language_code: "",
        language_probability: 0,
        words: [{ text: "Test", start: 0, end: 0.5, type: "word" }],
      };

      loadMockData(mockJson);

      const state = useWordTimelineStore.getState();
      expect(state.data).not.toBeNull();
      // Empty language_code defaults to "unknown"
      expect(state.data?.language_code).toBe("unknown");
    });

    it("should set error for invalid data structure", () => {
      // loadFromData validates the structure
      useWordTimelineStore
        .getState()
        .loadFromData({ text: "test" } as unknown as RawWordTimelineJson);

      const state = useWordTimelineStore.getState();
      expect(state.data).toBeNull();
      expect(state.error).not.toBeNull();
    });
  });

  describe("loadFromData - filename handling", () => {
    it("should use provided filename", () => {
      loadMockData(undefined, "custom.json");

      const state = useWordTimelineStore.getState();
      expect(state.fileName).toBe("custom.json");
    });

    it("should use default filename when not provided", () => {
      const mockJson = createMockJson();
      useWordTimelineStore.getState().loadFromData(mockJson);

      const state = useWordTimelineStore.getState();
      expect(state.fileName).toBe("data.json");
    });
  });

  // --------------------------------------------------------------------------
  // Word Deletion Tests
  // --------------------------------------------------------------------------

  describe("toggleWordDeleted", () => {
    it("should toggle word deleted state", () => {
      loadMockData();

      const wordId = useWordTimelineStore.getState().data!.words[0].id;

      // Toggle to deleted
      useWordTimelineStore.getState().toggleWordDeleted(wordId);
      expect(useWordTimelineStore.getState().data!.words[0].deleted).toBe(true);

      // Toggle back to not deleted
      useWordTimelineStore.getState().toggleWordDeleted(wordId);
      expect(useWordTimelineStore.getState().data!.words[0].deleted).toBe(
        false
      );
    });

    it("should not affect other words when toggling", () => {
      loadMockData();

      const wordId = useWordTimelineStore.getState().data!.words[0].id;

      useWordTimelineStore.getState().toggleWordDeleted(wordId);

      const state = useWordTimelineStore.getState();
      // First word deleted
      expect(state.data!.words[0].deleted).toBe(true);
      // Other words unchanged
      expect(state.data!.words[2].deleted).toBe(false);
      expect(state.data!.words[4].deleted).toBe(false);
    });

    it("should handle non-existent word ID gracefully", () => {
      loadMockData();

      // Should not throw
      useWordTimelineStore.getState().toggleWordDeleted("non-existent-id");

      const state = useWordTimelineStore.getState();
      const allNotDeleted = state.data?.words.every((w) => w.deleted === false);
      expect(allNotDeleted).toBe(true);
    });
  });

  describe("setWordsDeleted", () => {
    it("should set multiple words as deleted", () => {
      loadMockData();

      const wordIds = ["word-0", "word-2", "word-4"];

      useWordTimelineStore.getState().setWordsDeleted(wordIds, true);

      const state = useWordTimelineStore.getState();
      expect(state.data!.words[0].deleted).toBe(true);
      expect(state.data!.words[1].deleted).toBe(false); // spacing
      expect(state.data!.words[2].deleted).toBe(true);
      expect(state.data!.words[3].deleted).toBe(false); // spacing
      expect(state.data!.words[4].deleted).toBe(true);
    });

    it("should restore multiple words", () => {
      loadMockData();

      // Delete first
      useWordTimelineStore
        .getState()
        .setWordsDeleted(["word-0", "word-2"], true);

      // Restore
      useWordTimelineStore
        .getState()
        .setWordsDeleted(["word-0", "word-2"], false);

      const state = useWordTimelineStore.getState();
      expect(state.data!.words[0].deleted).toBe(false);
      expect(state.data!.words[2].deleted).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Selection Tests
  // --------------------------------------------------------------------------

  describe("selectWord", () => {
    it("should select a word by ID", () => {
      useWordTimelineStore.getState().selectWord("word-1");

      const state = useWordTimelineStore.getState();
      expect(state.selectedWordId).toBe("word-1");
    });

    it("should clear selection with null", () => {
      useWordTimelineStore.getState().selectWord("word-1");
      useWordTimelineStore.getState().selectWord(null);

      const state = useWordTimelineStore.getState();
      expect(state.selectedWordId).toBeNull();
    });

    it("should replace previous selection", () => {
      useWordTimelineStore.getState().selectWord("word-1");
      useWordTimelineStore.getState().selectWord("word-2");

      const state = useWordTimelineStore.getState();
      expect(state.selectedWordId).toBe("word-2");
    });
  });

  // --------------------------------------------------------------------------
  // Getter Tests
  // --------------------------------------------------------------------------

  describe("getVisibleWords", () => {
    it("should return only words (not spacing)", () => {
      loadMockData();

      const visibleWords = useWordTimelineStore.getState().getVisibleWords();

      expect(visibleWords).toHaveLength(3);
      expect(visibleWords[0].text).toBe("Hello");
      expect(visibleWords[1].text).toBe("world");
      expect(visibleWords[2].text).toBe("test");
    });

    it("should include deleted words in visible words", () => {
      loadMockData();

      useWordTimelineStore.getState().toggleWordDeleted("word-0");

      const visibleWords = useWordTimelineStore.getState().getVisibleWords();

      // Should still return 3 words (deleted words are visible but marked)
      expect(visibleWords).toHaveLength(3);
      expect(visibleWords[0].deleted).toBe(true);
    });

    it("should return empty array when no data loaded", () => {
      const visibleWords = useWordTimelineStore.getState().getVisibleWords();
      expect(visibleWords).toEqual([]);
    });
  });

  describe("getNonDeletedWords", () => {
    it("should exclude deleted words", () => {
      loadMockData();

      // Delete first word
      useWordTimelineStore.getState().toggleWordDeleted("word-0");

      const nonDeletedWords = useWordTimelineStore
        .getState()
        .getNonDeletedWords();

      expect(nonDeletedWords).toHaveLength(2);
      expect(nonDeletedWords[0].text).toBe("world");
      expect(nonDeletedWords[1].text).toBe("test");
    });

    it("should exclude spacing", () => {
      loadMockData();

      const nonDeletedWords = useWordTimelineStore
        .getState()
        .getNonDeletedWords();

      expect(nonDeletedWords).toHaveLength(3);
      expect(nonDeletedWords.every((w) => w.type === "word")).toBe(true);
    });
  });

  describe("getWordById", () => {
    it("should return word by ID", () => {
      loadMockData();

      const word = useWordTimelineStore.getState().getWordById("word-0");

      expect(word).not.toBeUndefined();
      expect(word?.text).toBe("Hello");
    });

    it("should return undefined for non-existent ID", () => {
      loadMockData();

      const word = useWordTimelineStore.getState().getWordById("non-existent");

      expect(word).toBeUndefined();
    });

    it("should return undefined when no data loaded", () => {
      const word = useWordTimelineStore.getState().getWordById("word-0");
      expect(word).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Clear Data Tests
  // --------------------------------------------------------------------------

  describe("clearData", () => {
    it("should reset all state", () => {
      loadMockData();

      useWordTimelineStore.getState().selectWord("word-0");
      useWordTimelineStore.getState().clearData();

      const state = useWordTimelineStore.getState();
      expect(state.data).toBeNull();
      expect(state.fileName).toBeNull();
      expect(state.selectedWordId).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle empty words array", () => {
      const mockJson: RawWordTimelineJson = {
        text: "",
        language_code: "eng",
        language_probability: 0.99,
        words: [],
      };

      loadMockData(mockJson);

      const state = useWordTimelineStore.getState();
      expect(state.data?.words).toEqual([]);
      expect(state.error).toBeNull();
    });

    it("should handle words with speaker_id", () => {
      const mockJson: RawWordTimelineJson = {
        text: "Hello",
        language_code: "eng",
        language_probability: 0.99,
        words: [
          {
            text: "Hello",
            start: 0,
            end: 0.5,
            type: "word",
            speaker_id: "speaker_0",
          },
        ],
      };

      loadMockData(mockJson);

      const state = useWordTimelineStore.getState();
      expect(state.data?.words[0].speaker_id).toBe("speaker_0");
    });

    it("should preserve original data when no data loaded", () => {
      useWordTimelineStore.getState().toggleWordDeleted("word-0");
      useWordTimelineStore.getState().selectWord("word-0");

      // Should not throw and state should remain null
      const state = useWordTimelineStore.getState();
      expect(state.data).toBeNull();
    });
  });
});
