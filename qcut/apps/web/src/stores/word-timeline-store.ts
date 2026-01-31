/**
 * Word Timeline Store
 *
 * Zustand store for managing word-level transcription data.
 * Supports loading from JSON files, word deletion marking, and selection state.
 *
 * @module stores/word-timeline-store
 */

import { create } from "zustand";
import type {
  WordTimelineData,
  WordItem,
  RawWordTimelineJson,
  RawWordItem,
} from "@/types/word-timeline";

// ============================================================================
// Types
// ============================================================================

interface WordTimelineState {
  /** Loaded word timeline data */
  data: WordTimelineData | null;
  /** Name of the loaded file */
  fileName: string | null;
  /** Currently selected word ID */
  selectedWordId: string | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if load failed */
  error: string | null;
}

interface WordTimelineActions {
  /** Load word timeline data from a JSON file */
  loadFromJson: (file: File) => Promise<void>;
  /** Load word timeline data from raw JSON object */
  loadFromData: (data: RawWordTimelineJson, fileName?: string) => void;
  /** Load from ElevenLabs transcription result (API response) */
  loadFromTranscription: (
    data: {
      text: string;
      language_code: string;
      language_probability: number;
      words: Array<{
        text: string;
        start: number;
        end: number;
        type: string;
        speaker_id: string | null;
      }>;
    },
    fileName: string
  ) => void;
  /** Toggle the deleted state of a word */
  toggleWordDeleted: (wordId: string) => void;
  /** Set multiple words as deleted */
  setWordsDeleted: (wordIds: string[], deleted: boolean) => void;
  /** Select a word by ID */
  selectWord: (wordId: string | null) => void;
  /** Clear all loaded data */
  clearData: () => void;
  /** Get only visible words (excluding spacing) */
  getVisibleWords: () => WordItem[];
  /** Get word by ID */
  getWordById: (wordId: string) => WordItem | undefined;
  /** Get non-deleted words for export */
  getNonDeletedWords: () => WordItem[];
}

type WordTimelineStore = WordTimelineState & WordTimelineActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: WordTimelineState = {
  data: null,
  fileName: null,
  selectedWordId: null,
  isLoading: false,
  error: null,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform raw words from JSON to include id and deleted flag.
 * Each word is assigned a unique ID based on its index and initialized
 * with deleted=false.
 *
 * @param rawWords - Array of raw word items from JSON
 * @returns Array of WordItem with id and deleted properties added
 */
function transformWords(rawWords: RawWordItem[]): WordItem[] {
  return rawWords.map((word, index) => ({
    ...word,
    id: `word-${index}`,
    deleted: false,
  }));
}

/**
 * Validate JSON structure matches expected word timeline format.
 * Checks that the JSON has a 'text' string and 'words' array where
 * each word has text (string), start/end (finite numbers), and
 * type ("word" or "spacing").
 *
 * @param json - Unknown JSON value to validate
 * @returns Type predicate indicating if json is RawWordTimelineJson
 */
function validateJson(json: unknown): json is RawWordTimelineJson {
  if (typeof json !== "object" || json === null) {
    return false;
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.text !== "string") {
    return false;
  }

  if (!Array.isArray(obj.words)) {
    return false;
  }

  const words = obj.words as Array<unknown>;
  for (const word of words) {
    if (typeof word !== "object" || word === null) {
      return false;
    }

    const entry = word as Record<string, unknown>;
    if (typeof entry.text !== "string") {
      return false;
    }

    if (typeof entry.start !== "number" || !Number.isFinite(entry.start)) {
      return false;
    }

    if (typeof entry.end !== "number" || !Number.isFinite(entry.end)) {
      return false;
    }

    if (entry.type !== "word" && entry.type !== "spacing") {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Store
// ============================================================================

export const useWordTimelineStore = create<WordTimelineStore>((set, get) => ({
  ...initialState,

  loadFromJson: async (file: File) => {
    set({ isLoading: true, error: null });

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      if (!validateJson(json)) {
        throw new Error(
          "Invalid JSON format. Expected word timeline structure with 'text' and 'words' array."
        );
      }

      const words = transformWords(json.words);

      set({
        data: {
          text: json.text,
          language_code: json.language_code || "unknown",
          language_probability: json.language_probability || 0,
          words,
        },
        fileName: file.name,
        selectedWordId: null,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load JSON file";
      set({
        isLoading: false,
        error: message,
      });
    }
  },

  loadFromData: (data: RawWordTimelineJson, fileName?: string) => {
    if (!validateJson(data)) {
      set({ error: "Invalid data format" });
      return;
    }

    const words = transformWords(data.words);

    set({
      data: {
        text: data.text,
        language_code: data.language_code || "unknown",
        language_probability: data.language_probability || 0,
        words,
      },
      fileName: fileName || "data.json",
      selectedWordId: null,
      isLoading: false,
      error: null,
    });
  },

  /**
   * Load from ElevenLabs transcription result.
   * This handles the API response format which may include additional word types
   * like "audio_event" and "punctuation" beyond the standard "word" and "spacing".
   */
  loadFromTranscription: (data, fileName) => {
    // Transform ElevenLabs response to our internal format
    const words: WordItem[] = data.words.map((word, index) => ({
      id: `word-${index}`,
      text: word.text,
      start: word.start,
      end: word.end,
      // Map ElevenLabs types to our internal types
      // Only "word" is kept as-is; everything else (spacing, audio_event, punctuation) becomes "spacing"
      type: word.type === "word" ? "word" : "spacing",
      speaker_id: word.speaker_id ?? undefined,
      deleted: false,
    }));

    set({
      data: {
        text: data.text,
        language_code: data.language_code,
        language_probability: data.language_probability,
        words,
      },
      fileName,
      selectedWordId: null,
      isLoading: false,
      error: null,
    });

  },

  toggleWordDeleted: (wordId: string) => {
    const { data } = get();
    if (!data) return;

    const words = data.words.map((w) =>
      w.id === wordId ? { ...w, deleted: !w.deleted } : w
    );

    set({ data: { ...data, words } });
  },

  setWordsDeleted: (wordIds: string[], deleted: boolean) => {
    const { data } = get();
    if (!data) return;

    const wordIdSet = new Set(wordIds);
    const words = data.words.map((w) =>
      wordIdSet.has(w.id) ? { ...w, deleted } : w
    );

    set({ data: { ...data, words } });
  },

  selectWord: (wordId: string | null) => {
    set({ selectedWordId: wordId });
  },

  clearData: () => {
    set(initialState);
  },

  getVisibleWords: () => {
    const { data } = get();
    if (!data) return [];
    return data.words.filter((w) => w.type === "word");
  },

  getWordById: (wordId: string) => {
    const { data } = get();
    if (!data) return undefined;
    return data.words.find((w) => w.id === wordId);
  },

  getNonDeletedWords: () => {
    const { data } = get();
    if (!data) return [];
    return data.words.filter((w) => w.type === "word" && !w.deleted);
  },
}));
