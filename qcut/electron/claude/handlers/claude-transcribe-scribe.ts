/**
 * ElevenLabs Scribe v2 for the editor API (`editor:transcribe:*` with
 * provider `elevenlabs`), on the first route that has credentials:
 *   1. ELEVENLABS_API_KEY → ElevenLabs directly, no FAL involved;
 *   2. a signed-in QCut account → the QCut cloud proxy (what the 字幕 panel
 *      already uses), so no key is needed at all;
 *   3. a FAL key → FAL's Scribe v2 endpoint.
 * Keys that cannot be real (a test placeholder, a FAL key outside its
 * key_id:key_secret form) are skipped, and when no route is left the error
 * says what each one needs instead of passing on FAL's 401 about its header.
 *
 * @module electron/claude/handlers/claude-transcribe-scribe
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDecryptedApiKeys } from "../../api-key-handler.js";
import { keyProblem } from "../../native-pipeline/infra/key-validity.js";
import {
	isProxyAvailable,
	proxyRequest,
	proxyUploadUrl,
} from "../../native-pipeline/infra/proxy-client.js";
import type {
	TranscriptionResult,
	TranscriptionSegment,
	TranscriptionWord,
} from "../../types/claude-api";
import { claudeLog } from "../utils/logger.js";

const HANDLER_NAME = "Transcribe";
const TRANSCRIPTION_TIMEOUT_MS = 5 * 60 * 1000;
const FAL_SCRIBE_URL =
	"https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2";
const ELEVENLABS_SPEECH_TO_TEXT_URL =
	"https://api.elevenlabs.io/v1/speech-to-text";
const FAL_STORAGE_INITIATE_URL =
	"https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

export type ScribeRoute =
	| { kind: "elevenlabs"; apiKey: string }
	| { kind: "qcut-cloud" }
	| { kind: "fal"; apiKey: string };

interface ScribeWord {
	text: string;
	start: number;
	end: number;
	type: string;
	speaker_id?: string | null;
}

interface ScribeResponse {
	text?: string;
	language_code?: string;
	words?: ScribeWord[];
}

/** The first Scribe route with usable credentials; see the module comment. */
export async function resolveScribeRoute({
	keys,
	proxyAvailable,
}: {
	keys?: { elevenLabsApiKey?: string; falApiKey?: string };
	proxyAvailable?: boolean;
} = {}): Promise<ScribeRoute> {
	const resolved = keys ?? (await getDecryptedApiKeys());
	const skipped: string[] = [];
	const elevenLabs = resolved.elevenLabsApiKey?.trim();
	if (elevenLabs) {
		const problem = keyProblem({
			name: "ELEVENLABS_API_KEY",
			value: elevenLabs,
		});
		if (!problem) return { kind: "elevenlabs", apiKey: elevenLabs };
		skipped.push(`ELEVENLABS_API_KEY ${problem}`);
	}
	if (proxyAvailable ?? (await isProxyAvailable()))
		return { kind: "qcut-cloud" };
	const fal = resolved.falApiKey?.trim();
	if (fal) {
		const problem = keyProblem({ name: "FAL_KEY", value: fal });
		if (!problem) return { kind: "fal", apiKey: fal };
		skipped.push(`FAL_KEY ${problem}`);
	}
	throw new Error(
		[
			"ElevenLabs transcription has no usable credentials. It needs one of:",
			"ELEVENLABS_API_KEY (calls ElevenLabs directly; `qcut set-key --name ELEVENLABS_API_KEY`),",
			"a signed-in QCut account (`qcut login`; uses QCut cloud),",
			"or a FAL key in key_id:key_secret form (`qcut set-key --name FAL_KEY`).",
			...(skipped.length > 0 ? [`Skipped: ${skipped.join("; ")}.`] : []),
		].join(" ")
	);
}

function requestBody({
	audioUrl,
	language,
	diarize,
}: {
	audioUrl: string;
	language?: string;
	diarize: boolean;
}): Record<string, unknown> {
	return {
		audio_url: audioUrl,
		diarize,
		tag_audio_events: true,
		...(language ? { language_code: language } : {}),
	};
}

async function uploadToFal({
	audioPath,
	apiKey,
}: {
	audioPath: string;
	apiKey: string;
}): Promise<string> {
	const fileBuffer = await readFile(audioPath);
	const initResponse = await fetch(FAL_STORAGE_INITIATE_URL, {
		method: "POST",
		headers: {
			Authorization: `Key ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			file_name: basename(audioPath),
			content_type: "audio/mpeg",
		}),
	});
	if (!initResponse.ok) {
		throw new Error(
			`FAL storage initiate failed: ${initResponse.status} ${await initResponse.text()}`
		);
	}
	const initData = (await initResponse.json()) as {
		upload_url?: string;
		file_url?: string;
	};
	if (!initData.upload_url || !initData.file_url) {
		throw new Error("FAL storage did not return upload URLs");
	}
	const upload = await fetch(initData.upload_url, {
		method: "PUT",
		headers: { "Content-Type": "audio/mpeg" },
		body: new Uint8Array(fileBuffer),
	});
	if (!upload.ok) {
		throw new Error(`FAL storage upload failed: ${upload.status}`);
	}
	return initData.file_url;
}

async function transcribeViaQCutCloud({
	audioPath,
	language,
	diarize,
}: {
	audioPath: string;
	language?: string;
	diarize: boolean;
}): Promise<ScribeResponse> {
	const fileBuffer = await readFile(audioPath);
	const signed = await proxyUploadUrl({
		fileName: basename(audioPath),
		contentType: "audio/mpeg",
		fileSize: fileBuffer.length,
	});
	const upload = await fetch(signed.uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": "audio/mpeg" },
		body: new Uint8Array(fileBuffer),
	});
	if (!upload.ok) {
		throw new Error(`QCut cloud upload failed: ${upload.status}`);
	}
	const response = await proxyRequest({
		provider: "fal",
		endpoint: FAL_SCRIBE_URL,
		method: "POST",
		body: requestBody({ audioUrl: signed.fileUrl, language, diarize }),
		timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
	});
	if (!response.ok) {
		const preview =
			typeof response.data === "string"
				? response.data.slice(0, 300)
				: JSON.stringify(response.data).slice(0, 300);
		throw new Error(
			`QCut cloud ElevenLabs transcription failed: ${response.status} ${preview}`
		);
	}
	return response.data as ScribeResponse;
}

async function transcribeViaFal({
	audioPath,
	language,
	diarize,
	apiKey,
}: {
	audioPath: string;
	language?: string;
	diarize: boolean;
	apiKey: string;
}): Promise<ScribeResponse> {
	const audioUrl = await uploadToFal({ audioPath, apiKey });
	const response = await fetch(FAL_SCRIBE_URL, {
		method: "POST",
		headers: {
			Authorization: `Key ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody({ audioUrl, language, diarize })),
		signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`ElevenLabs (via FAL) API error: ${response.status} ${await response.text()}`
		);
	}
	return (await response.json()) as ScribeResponse;
}

async function transcribeViaElevenLabs({
	audioPath,
	language,
	diarize,
	apiKey,
}: {
	audioPath: string;
	language?: string;
	diarize: boolean;
	apiKey: string;
}): Promise<ScribeResponse> {
	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(await readFile(audioPath))]),
		basename(audioPath)
	);
	form.append("model_id", "scribe_v2");
	form.append("diarize", String(diarize));
	form.append("tag_audio_events", "true");
	if (language) form.append("language_code", language);
	const response = await fetch(ELEVENLABS_SPEECH_TO_TEXT_URL, {
		method: "POST",
		headers: { "xi-api-key": apiKey },
		body: form,
		signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`ElevenLabs API error: ${response.status} ${await response.text()}`
		);
	}
	return (await response.json()) as ScribeResponse;
}

/** A pause longer than this between words starts a new segment. */
const SEGMENT_PAUSE_SECONDS = 0.5;

/**
 * Groups word-level output into segments, starting a new one at a pause
 * (spacing or an audio event) longer than half a second. Scribe sends the spaces
 * between words as their own `spacing` items, which are kept, so English
 * reads "Round one", not "Roundone".
 */
export function buildSegments(
	words: TranscriptionWord[]
): TranscriptionSegment[] {
	const segments: TranscriptionSegment[] = [];
	let currentText = "";
	let segStart = -1;
	let segEnd = 0;
	const flush = () => {
		if (currentText.trim() && segStart >= 0) {
			segments.push({ text: currentText.trim(), start: segStart, end: segEnd });
		}
		currentText = "";
		segStart = -1;
	};

	for (const word of words) {
		if (word.type === "word" || word.type === "punctuation") {
			if (segStart < 0) segStart = word.start;
			segEnd = word.end;
			currentText += word.text;
			continue;
		}
		if (word.end - word.start > SEGMENT_PAUSE_SECONDS) {
			flush();
			continue;
		}
		if (word.type === "spacing" && segStart >= 0) currentText += word.text;
	}
	flush();
	return segments;
}

/** Transcribes with Scribe v2 on the first route that has credentials. */
export async function transcribeWithElevenLabs(
	audioPath: string,
	language?: string,
	diarize = true
): Promise<TranscriptionResult & { route: ScribeRoute["kind"] }> {
	const route = await resolveScribeRoute();
	claudeLog.info(HANDLER_NAME, `ElevenLabs Scribe v2 via ${route.kind}`);
	const result =
		route.kind === "elevenlabs"
			? await transcribeViaElevenLabs({
					audioPath,
					language,
					diarize,
					apiKey: route.apiKey,
				})
			: route.kind === "qcut-cloud"
				? await transcribeViaQCutCloud({ audioPath, language, diarize })
				: await transcribeViaFal({
						audioPath,
						language,
						diarize,
						apiKey: route.apiKey,
					});

	const words: TranscriptionWord[] = (result.words ?? []).map((word) => ({
		text: word.text,
		start: word.start,
		end: word.end,
		type: word.type as TranscriptionWord["type"],
		speaker: word.speaker_id ?? undefined,
	}));
	return {
		words,
		segments: buildSegments(words),
		language: result.language_code || "unknown",
		duration: words.length > 0 ? words[words.length - 1].end : 0,
		route: route.kind,
	};
}
