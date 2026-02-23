/**
 * ElevenLabs transcription types.
 */

/**
 * Word-level transcription item from ElevenLabs Scribe v2.
 */
export interface ElevenLabsTranscriptionWord {
	/** The transcribed word or event text */
	text: string;
	/** Start time in seconds */
	start: number;
	/** End time in seconds */
	end: number;
	/** Type of element */
	type: "word" | "spacing" | "audio_event" | "punctuation";
	/** Speaker identifier (if diarization enabled) */
	speaker_id: string | null;
}

/**
 * Full transcription result from ElevenLabs Scribe v2.
 */
export interface ElevenLabsTranscribeResult {
	/** Full transcription text */
	text: string;
	/** Detected/specified language code */
	language_code: string;
	/** Confidence score for language detection (0-1) */
	language_probability: number;
	/** Word-level transcription data */
	words: ElevenLabsTranscriptionWord[];
}
