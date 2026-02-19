/**
 * CLI Media Analysis & Transcription Handlers
 *
 * Handles analyze-video and transcribe commands with expanded
 * options (analysis types, output formats, SRT generation).
 * Extracted from cli-runner.ts to keep file sizes manageable.
 *
 * @module electron/native-pipeline/cli-handlers-media
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CLIRunOptions, CLIResult } from "./cli-runner.js";
import { ModelRegistry } from "./registry.js";
import type { PipelineStep } from "./executor.js";
import type { PipelineExecutor } from "./executor.js";
import { resolveOutputDir } from "./output-utils.js";

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

  const model = options.model || "gemini_qa";
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
    timeline: "Create a detailed timeline of events in this video",
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

  // Output format handling (md, json, both)
  const outputFormat = options.outputFormat || "md";
  if (
    result.success &&
    resultData &&
    (outputFormat === "json" || outputFormat === "both")
  ) {
    const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
    const jsonPath = join(outputDir, "analysis.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({ type: analysisType, content: resultData }, null, 2)
    );

    if (outputFormat === "both") {
      const mdPath = join(outputDir, "analysis.md");
      writeFileSync(
        mdPath,
        typeof resultData === "string"
          ? resultData
          : JSON.stringify(resultData, null, 2)
      );
      return {
        success: true,
        outputPath: jsonPath,
        outputPaths: [jsonPath, mdPath],
        data: resultData,
        duration: (Date.now() - startTime) / 1000,
      };
    }

    return {
      success: true,
      outputPath: jsonPath,
      data: resultData,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  return {
    success: result.success,
    error: result.error,
    data: resultData,
    duration: (Date.now() - startTime) / 1000,
  };
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

  // Save raw JSON response if requested
  if (options.rawJson && result.data) {
    const rawPath = join(outputDir, "transcription_raw.json");
    writeFileSync(rawPath, JSON.stringify(result.data, null, 2));
    outputPaths.push(rawPath);
  }

  // Generate SRT subtitle file if requested
  if (options.srt && result.data) {
    const { extractWordTimestamps, generateSrt } = await import(
      "./srt-generator.js"
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

  return {
    success: true,
    error: result.error,
    outputPath: outputPaths[0],
    outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
    data: result.text || result.data,
    duration: (Date.now() - startTime) / 1000,
  };
}
