/**
 * `editor transcribe start --to-captions`: a finished transcription goes
 * straight onto captions tracks, through the same import as `captions
 * import` (one transaction, overlapping cues on their own lanes, `--style`
 * and `--preset`, `--replace`).
 *
 * @module electron/native-pipeline/editor/editor-transcript-captions
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { type Cue, importCaptionCues } from "./editor-handlers-captions.js";

interface TranscriptWord {
	text: string;
	start: number;
	end: number;
	type?: string;
}

interface Transcript {
	words?: TranscriptWord[];
	segments?: Array<{ text: string; start: number; end: number }>;
	language?: string;
}

/** A cue ends at a sentence end, a pause, or once it is this long. */
const MAX_CUE_SECONDS = 6;
/** Half-width columns: a CJK character counts two, as on screen. */
const MAX_CUE_COLUMNS = 42;
const PAUSE_SECONDS = 0.5;
const SENTENCE_END = /[。！？!?.…；;]["”’」』）)]*$/;

function columns(text: string): number {
	let width = 0;
	for (const char of text) {
		width += /[⺀-鿿가-힯＀-￯]/.test(char) ? 2 : 1;
	}
	return width;
}

/**
 * Caption cues from a transcript: from its words when it has them (Scribe),
 * so every cue starts and ends on a word, else from its segments.
 */
export function cuesFromTranscript({
	transcript,
	language,
	style,
}: {
	transcript: Transcript;
	language: string;
	style?: unknown;
}): Cue[] {
	const cues: Cue[] = [];
	const push = (text: string, start: number, end: number) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		cues.push({
			text: trimmed,
			startTime: start,
			duration: Math.max(0.3, end - start),
			language,
			...(style ? { style } : {}),
		});
	};
	const words = transcript.words ?? [];
	if (words.length === 0) {
		for (const segment of transcript.segments ?? []) {
			push(segment.text, segment.start, segment.end);
		}
		return cues;
	}
	let text = "";
	let start = -1;
	let end = 0;
	const flush = () => {
		if (start >= 0) push(text, start, end);
		text = "";
		start = -1;
	};
	for (const word of words) {
		const type = word.type ?? "word";
		if (type !== "word" && type !== "punctuation") {
			if (word.end - word.start > PAUSE_SECONDS) flush();
			else if (type === "spacing" && start >= 0) text += word.text;
			continue;
		}
		if (start < 0) start = word.start;
		text += word.text;
		end = word.end;
		if (
			SENTENCE_END.test(text.trim()) ||
			columns(text.trim()) >= MAX_CUE_COLUMNS ||
			end - start >= MAX_CUE_SECONDS
		) {
			flush();
		}
	}
	flush();
	return cues;
}

/**
 * Imports a finished transcription job's result as captions. `style` is
 * resolved by the caller before it starts the job, so a bad `--style` or
 * `--preset` fails before transcribing rather than after.
 */
export async function transcriptToCaptions({
	client,
	opts,
	transcript,
	style,
}: {
	client: EditorApiClient;
	opts: CLIRunOptions;
	transcript: Transcript | undefined;
	style?: Record<string, unknown>;
}): Promise<CLIResult> {
	if (!transcript) {
		return { success: false, error: "The transcription returned no result" };
	}
	const cues = cuesFromTranscript({
		// Gemini's "words" are its whole segments, with no spacing between
		// them: joined as words they would run together.
		transcript:
			opts.provider === "gemini"
				? { ...transcript, words: undefined }
				: transcript,
		language: opts.language ?? transcript.language ?? "en",
		style,
	});
	if (cues.length === 0) {
		return {
			success: false,
			error: "The transcription has no speech to caption",
		};
	}
	return importCaptionCues({ client, opts, cues });
}
