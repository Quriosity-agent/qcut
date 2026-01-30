/**
 * Word Timeline Types
 *
 * Type definitions for word-level transcription data loaded from JSON files.
 * Supports word-by-word playback navigation and deletion marking.
 *
 * @module types/word-timeline
 */

/**
 * Individual word item from transcription JSON.
 */
export interface WordItem {
  /** Unique identifier for the word */
  id: string;
  /** The word text content */
  text: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Type of item: "word" for actual words, "spacing" for whitespace */
  type: "word" | "spacing";
  /** Optional speaker identification */
  speaker_id?: string;
  /** Whether the word is marked for deletion */
  deleted: boolean;
}

/**
 * Raw word data from JSON file (before transformation).
 */
export interface RawWordItem {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing";
  speaker_id?: string;
}

/**
 * Complete word timeline data structure from JSON.
 */
export interface WordTimelineData {
  /** Full transcription text */
  text: string;
  /** Language code (e.g., "eng") */
  language_code: string;
  /** Language detection probability (0-1) */
  language_probability: number;
  /** Array of word items with timing */
  words: WordItem[];
}

/**
 * Raw JSON structure from transcription files.
 */
export interface RawWordTimelineJson {
  text: string;
  language_code: string;
  language_probability: number;
  words: RawWordItem[];
}
