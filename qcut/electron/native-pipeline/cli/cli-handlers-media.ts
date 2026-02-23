/**
 * CLI Media Analysis & Transcription Handlers
 *
 * Handles analyze-video and transcribe commands with expanded
 * options (analysis types, output formats, SRT generation).
 * Extracted from cli-runner.ts to keep file sizes manageable.
 *
 * @module electron/native-pipeline/cli-handlers-media
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { CLIRunOptions, CLIResult } from "../cli/cli-runner.js";
import { ModelRegistry } from "../infra/registry.js";
import type { PipelineStep } from "../execution/executor.js";
import type { PipelineExecutor } from "../execution/executor.js";
import { resolveOutputDir } from "../output/output-utils.js";
import { createEditorClient } from "../editor/editor-api-client.js";

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;

export async function handleAnalyzeVideo(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	const videoInput = options.input || options.videoUrl;
	if (!videoInput) {
		return { success: false, error: "Missing --input/-i (video path/URL)" };
	}

	const model = options.model || "fal_video_qa";
	if (!ModelRegistry.has(model)) {
		return { success: false, error: `Unknown model '${model}'` };
	}

	const startTime = Date.now();
	onProgress({
		stage: "analyzing",
		percent: 0,
		message: "Analyzing video...",
		model,
	});

	// Analysis type determines the default prompt
	const analysisType = options.analysisType || "timeline";
	const promptMap: Record<string, string> = {
		timeline:
			'Analyze this video and return a JSON array of timestamped events. Each entry should have "start" (seconds), "end" (seconds), "label" (short description), and "tags" (array of keywords). Example: [{"start":0,"end":2.5,"label":"City skyline establishing shot","tags":["establishing","city"]}]. Return ONLY valid JSON, no markdown.',
		summary: "Provide a comprehensive summary of this video",
		description: "Describe this video in detail",
		transcript: "Transcribe all spoken words in this video",
	};
	const defaultPrompt =
		promptMap[analysisType] || "Describe this video in detail";

	const step: PipelineStep = {
		type: "image_understanding",
		model,
		params: {
			prompt: options.prompt || options.text || defaultPrompt,
			analysis_type: analysisType,
		},
		enabled: true,
		retryCount: 0,
	};

	const result = await executor.executeStep(
		step,
		{ videoUrl: videoInput },
		{ outputDir: options.outputDir, signal }
	);

	onProgress({ stage: "complete", percent: 100, message: "Done", model });

	const resultData = result.text || result.data;

	if (!result.success) {
		return {
			success: false,
			error: result.error,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	// Always save JSON alongside the video (same name, .json extension)
	// Output dir: explicit -o flag > video's directory
	const videoBasename = basename(
		videoInput,
		`.${videoInput.split(".").pop()}`
	);
	const outputDir = options.outputDir || dirname(videoInput);
	const jsonPath = join(outputDir, `${videoBasename}.json`);

	// Parse structured JSON from model response if possible
	let parsed: unknown = resultData;
	if (typeof resultData === "string") {
		try {
			// Strip markdown code fences if present
			const cleaned = resultData
				.replace(/^```(?:json)?\n?/m, "")
				.replace(/\n?```$/m, "")
				.trim();
			parsed = JSON.parse(cleaned);
		} catch {
			// Keep as-is if not valid JSON
		}
	}

	const output = {
		type: analysisType,
		video: basename(videoInput),
		model,
		duration: (Date.now() - startTime) / 1000,
		content: parsed,
	};

	try {
		mkdirSync(outputDir, { recursive: true });
		writeFileSync(jsonPath, JSON.stringify(output, null, 2));
	} catch (err) {
		return {
			success: false,
			error: `Failed to write ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
			duration: output.duration,
		};
	}

	// Add video + scene markdown to editor timeline if requested
	if (options.addToTimeline && options.projectId) {
		const timelineResult = await addAnalysisToTimeline(
			options,
			videoInput,
			parsed,
			onProgress
		);
		if (!timelineResult.success) {
			// Non-fatal: analysis succeeded, timeline push failed
			console.error(
				`[analyze-video] Timeline integration failed: ${timelineResult.error}`
			);
		}
	}

	return {
		success: true,
		outputPath: jsonPath,
		data: output,
		duration: output.duration,
	};
}

interface TimelineEvent {
	start: number;
	end: number;
	label: string;
	tags?: string[];
}

/** Import video + markdown scene annotations into the editor timeline. */
async function addAnalysisToTimeline(
	options: CLIRunOptions,
	videoPath: string,
	analysisContent: unknown,
	onProgress: ProgressFn
): Promise<{ success: boolean; error?: string }> {
	const projectId = options.projectId!;
	const client = createEditorClient(options);

	// Check editor is running
	const healthy = await client.checkHealth();
	if (!healthy) {
		return { success: false, error: "QCut editor not reachable" };
	}

	onProgress({
		stage: "timeline",
		percent: 80,
		message: "Importing video to editor...",
	});

	// 1. Import video into media library
	const absPath = resolve(videoPath);
	const media = (await client.post(
		`/api/claude/media/${projectId}/import`,
		{ source: absPath }
	)) as { id?: string; name?: string; duration?: number };

	if (!media?.id) {
		return { success: false, error: "Failed to import video to media library" };
	}

	// 2. Get timeline to find track IDs
	const timeline = (await client.get(
		`/api/claude/timeline/${projectId}`
	)) as {
		tracks?: { id: string; type: string; name: string }[];
	};

	const tracks = timeline?.tracks || [];
	const mediaTrack = tracks.find((t) => t.type === "media");
	const markdownTrack = tracks.find((t) => t.type === "markdown");

	if (!mediaTrack) {
		return { success: false, error: "No media track found in timeline" };
	}

	// 3. Build media element
	const events = Array.isArray(analysisContent)
		? (analysisContent as TimelineEvent[])
		: [];

	const videoDuration = media.duration || (events.length > 0
		? Math.max(...events.map((e) => e.end))
		: 10);

	onProgress({
		stage: "timeline",
		percent: 85,
		message: "Adding video to timeline...",
	});

	// 4. Add media element via single-element endpoint
	//    (auto-resolves media from store and creates track if needed)
	await client.post(
		`/api/claude/timeline/${projectId}/elements`,
		{
			type: "media",
			sourceId: media.id,
			sourceName: media.name || basename(videoPath),
			startTime: 0,
			duration: videoDuration,
		}
	);

	// 5. Add markdown scene annotations via single-element endpoint
	//    (auto-creates markdown track via findOrCreateTrack)
	let addedMarkdown = 0;
	if (events.length > 0) {
		onProgress({
			stage: "timeline",
			percent: 90,
			message: "Adding scene annotations...",
		});

		for (const event of events) {
			const duration = event.end - event.start;
			if (duration <= 0) continue;

			const tags = event.tags?.length
				? `\n\n*${event.tags.join(", ")}*`
				: "";

			await client.post(
				`/api/claude/timeline/${projectId}/elements`,
				{
					type: "markdown",
					content: `## ${event.label}${tags}`,
					startTime: event.start,
					duration,
				}
			);
			addedMarkdown++;
		}
	}

	onProgress({
		stage: "timeline",
		percent: 100,
		message: `Added video + ${addedMarkdown} scene annotations to timeline`,
	});

	return { success: true };
}

export async function handleTranscribe(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	const audioInput = options.input || options.audioUrl;
	if (!audioInput) {
		return { success: false, error: "Missing --input/-i (audio path/URL)" };
	}

	const model = options.model || "scribe_v2";
	if (!ModelRegistry.has(model)) {
		return { success: false, error: `Unknown model '${model}'` };
	}

	const startTime = Date.now();
	onProgress({
		stage: "transcribing",
		percent: 0,
		message: "Transcribing audio...",
		model,
	});

	// Build STT params from options
	const params: Record<string, unknown> = {};
	if (options.language) params.language = options.language;
	if (options.noDiarize) params.diarize = false;
	if (options.noTagEvents) params.tag_audio_events = false;
	if (options.keyterms && options.keyterms.length > 0) {
		params.keyterms = options.keyterms;
	}

	const step: PipelineStep = {
		type: "speech_to_text",
		model,
		params,
		enabled: true,
		retryCount: 0,
	};

	const result = await executor.executeStep(
		step,
		{ audioUrl: audioInput },
		{ outputDir: options.outputDir, signal }
	);

	onProgress({ stage: "complete", percent: 100, message: "Done", model });

	if (!result.success) {
		return {
			success: false,
			error: result.error,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
	const outputPaths: string[] = [];

	try {
		// Save raw JSON response if requested
		if (options.rawJson && result.data) {
			const rawPath = join(outputDir, "transcription_raw.json");
			writeFileSync(rawPath, JSON.stringify(result.data, null, 2));
			outputPaths.push(rawPath);
		}

		// Generate SRT subtitle file if requested
		if (options.srt && result.data) {
			const { extractWordTimestamps, generateSrt } = await import(
				"../output/srt-generator.js"
			);
			const words = extractWordTimestamps(result.data);
			if (words && words.length > 0) {
				const srtContent = generateSrt(words, {
					maxWords: options.srtMaxWords,
					maxDuration: options.srtMaxDuration,
				});
				const srtPath = join(outputDir, "transcription.srt");
				writeFileSync(srtPath, srtContent);
				outputPaths.push(srtPath);
			}
		}
	} catch (err) {
		return {
			success: false,
			error: `Failed to write transcription output: ${err instanceof Error ? err.message : String(err)}`,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	return {
		success: true,
		error: result.error,
		outputPath: outputPaths[0],
		outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
		data: result.text || result.data,
		duration: (Date.now() - startTime) / 1000,
	};
}
