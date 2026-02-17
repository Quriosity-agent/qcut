/**
 * FFmpeg Export Handler
 *
 * The main export-video-cli IPC handler supporting three export modes:
 * - Mode 1: Direct copy (fast, lossless concat) for sequential videos
 * - Mode 1.5: Video normalization with FFmpeg padding
 * - Mode 2: Direct video with FFmpeg filters for text/stickers/effects
 *
 * Location: electron/ffmpeg-export-handler.ts
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import type { TempManager } from "./temp-manager.js";

import type {
  VideoSource,
  ExportOptions,
  ExportResult,
  FFmpegError,
  FFmpegProgress,
} from "./ffmpeg/types";

import {
  MAX_EXPORT_DURATION,
  debugLog,
  getFFmpegPath,
  getFFprobePath,
  parseProgress,
  probeVideoFile,
  normalizeVideo,
} from "./ffmpeg/utils";

import { buildFFmpegArgs } from "./ffmpeg-args-builder.js";
import { buildFilterCutComplex } from "./ffmpeg-filter-cut.js";

/**
 * Registers the export-video-cli IPC handler.
 *
 * This is the main video export handler that orchestrates all 3 export modes.
 */
export function setupExportHandler(tempManager: TempManager): void {
  ipcMain.handle(
    "export-video-cli",
    async (
      event: IpcMainInvokeEvent,
      options: ExportOptions
    ): Promise<ExportResult> => {
      const {
        sessionId,
        width,
        height,
        fps,
        quality,
        duration,
        audioFiles = [],
        textFilterChain,
        stickerFilterChain,
        stickerSources,
        useDirectCopy = false,
      } = options;

      // Early debug logging to diagnose export issues
      debugLog(
        "🔍 [FFMPEG HANDLER] ============================================"
      );
      debugLog("🔍 [FFMPEG HANDLER] Export options received:");
      debugLog("🔍 [FFMPEG HANDLER]   - sessionId:", sessionId);
      debugLog("🔍 [FFMPEG HANDLER]   - dimensions:", `${width}x${height}`);
      debugLog("🔍 [FFMPEG HANDLER]   - fps:", fps);
      debugLog("🔍 [FFMPEG HANDLER]   - quality:", quality);
      debugLog("🔍 [FFMPEG HANDLER]   - duration:", duration);
      debugLog("🔍 [FFMPEG HANDLER]   - useDirectCopy:", useDirectCopy);
      debugLog("🔍 [FFMPEG HANDLER]   - useVideoInput:", options.useVideoInput);
      debugLog(
        "🔍 [FFMPEG HANDLER]   - videoInputPath:",
        options.videoInputPath
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - videoSources count:",
        options.videoSources?.length || 0
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - optimizationStrategy:",
        options.optimizationStrategy
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - wordFilterSegments count:",
        options.wordFilterSegments?.length || 0
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - filterChain:",
        options.filterChain ? "present" : "none"
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - textFilterChain:",
        textFilterChain ? "present" : "none"
      );
      debugLog(
        "🔍 [FFMPEG HANDLER]   - stickerFilterChain:",
        stickerFilterChain ? "present" : "none"
      );
      if (options.videoSources && options.videoSources.length > 0) {
        debugLog("🔍 [FFMPEG HANDLER] Video sources:");
        for (const [i, v] of options.videoSources.entries()) {
          debugLog(`🔍 [FFMPEG HANDLER]   [${i}] path: ${v.path}`);
          debugLog(
            `🔍 [FFMPEG HANDLER]   [${i}] duration: ${v.duration}, trimStart: ${v.trimStart}, trimEnd: ${v.trimEnd}`
          );
        }
      }
      debugLog(
        "🔍 [FFMPEG HANDLER] ============================================"
      );

      // Validate sticker configuration
      if (
        stickerFilterChain &&
        (!stickerSources || stickerSources.length === 0)
      ) {
        throw new Error(
          "Sticker filter chain provided without sticker sources"
        );
      }
      if (
        options.imageFilterChain &&
        (!options.imageSources || options.imageSources.length === 0)
      ) {
        throw new Error("Image filter chain provided without image sources");
      }

      // Check if any video has trim values (concat demuxer can't handle per-video trimming)
      const hasTrimmedVideos =
        options.videoSources &&
        options.videoSources.length > 1 &&
        options.videoSources.some(
          (v: VideoSource) =>
            (v.trimStart && v.trimStart > 0) || (v.trimEnd && v.trimEnd > 0)
        );

      if (hasTrimmedVideos) {
        debugLog(
          "[FFmpeg] Trimmed videos detected in multi-video mode - will use Mode 1.5 normalization"
        );
      }

      // Disable direct copy when stickers, text, or trimmed multi-videos are present
      const effectiveUseDirectCopy =
        useDirectCopy &&
        !textFilterChain &&
        !stickerFilterChain &&
        !options.filterChain &&
        !options.imageFilterChain &&
        !(options.imageSources && options.imageSources.length > 0) &&
        !hasTrimmedVideos;

      // Validate duration to prevent crashes or excessive resource usage
      const validatedDuration = Math.min(
        Math.max(duration || 0.1, 0.1),
        MAX_EXPORT_DURATION
      );

      return new Promise<ExportResult>((resolve, reject) => {
        // Get session directories
        const frameDir: string = tempManager.getFrameDir(sessionId);
        const outputDir: string = tempManager.getOutputDir(sessionId);
        const outputFile: string = path.join(outputDir, "output.mp4");

        // Construct FFmpeg arguments
        let ffmpegPath: string;
        try {
          ffmpegPath = getFFmpegPath();
        } catch (error: any) {
          reject(error);
          return;
        }

        const buildArgs = () =>
          buildFFmpegArgs({
            inputDir: frameDir,
            outputFile,
            width,
            height,
            fps,
            quality,
            duration: validatedDuration,
            audioFiles,
            filterChain: options.filterChain,
            textFilterChain,
            useDirectCopy: effectiveUseDirectCopy,
            videoSources: options.videoSources,
            stickerFilterChain,
            stickerSources,
            imageFilterChain: options.imageFilterChain,
            imageSources: options.imageSources,
            useVideoInput: options.useVideoInput || false,
            videoInputPath: options.videoInputPath,
            trimStart: options.trimStart,
            trimEnd: options.trimEnd,
          });

        // Mode 1.5 builds its own args; defer until after Mode 1.5 branch when needed
        let args: string[] | null =
          options.optimizationStrategy === "video-normalization"
            ? null
            : buildArgs();

        // Use async IIFE to handle validation properly
        (async () => {
          // Debug: Log the optimization strategy received
          console.log(
            `🔍 [FFMPEG HANDLER] Received optimizationStrategy: "${options.optimizationStrategy}"`
          );
          console.log(
            `🔍 [FFMPEG HANDLER] effectiveUseDirectCopy: ${effectiveUseDirectCopy}`
          );
          console.log(
            `🔍 [FFMPEG HANDLER] videoSources count: ${options.videoSources?.length || 0}`
          );
          console.log(
            `🔍 [FFMPEG HANDLER] useVideoInput: ${options.useVideoInput}`
          );

          // =============================================================================
          // MODE 1.5: Video Normalization with FFmpeg Padding
          // =============================================================================
          if (options.optimizationStrategy === "video-normalization") {
            await handleMode1_5(
              options,
              ffmpegPath,
              frameDir,
              outputFile,
              width,
              height,
              fps,
              audioFiles,
              event,
              resolve,
              reject
            );
            return;
          }

          if (
            options.wordFilterSegments &&
            options.wordFilterSegments.length > 0
          ) {
            await handleWordFilterCut({
              options,
              ffmpegPath,
              outputFile,
              event,
              resolve,
              reject,
            });
            return;
          }

          // Continue with existing mode validations (Mode 1, 2)
          if (effectiveUseDirectCopy) {
            // MODE 1: Direct copy - validate video sources
            if (!options.videoSources || options.videoSources.length === 0) {
              reject(
                new Error(
                  "Direct copy mode requested but no video sources provided."
                )
              );
              return;
            }

            // Validate each video source file exists
            for (const video of options.videoSources) {
              if (!fs.existsSync(video.path)) {
                reject(new Error(`Video source not found: ${video.path}`));
                return;
              }
            }

            // Validate codec compatibility for concat (only if multiple videos)
            if (options.videoSources.length > 1) {
              try {
                const probeResults = await Promise.all(
                  options.videoSources.map((video: VideoSource) =>
                    probeVideoFile(video.path)
                  )
                );

                const reference = probeResults[0];
                for (let i = 1; i < probeResults.length; i++) {
                  const current = probeResults[i];

                  if (
                    reference.codec !== current.codec ||
                    reference.width !== current.width ||
                    reference.height !== current.height ||
                    reference.pix_fmt !== current.pix_fmt ||
                    reference.fps !== current.fps
                  ) {
                    reject(
                      new Error(
                        "Video codec mismatch detected - direct copy requires identical encoding."
                      )
                    );
                    return;
                  }
                }
              } catch (probeError: any) {
                reject(
                  new Error(
                    `Failed to validate video compatibility: ${probeError.message}`
                  )
                );
                return;
              }
            }
          } else if (options.useVideoInput && options.videoInputPath) {
            // MODE 2: Direct video input with filters
            console.log(
              "⚡ [MODE 2 VALIDATION] Validating video input file..."
            );

            if (!fs.existsSync(options.videoInputPath)) {
              reject(
                new Error(
                  `Mode 2 video input not found: ${options.videoInputPath}`
                )
              );
              return;
            }

            console.log(
              "⚡ [MODE 2 VALIDATION] ✅ Video file validated successfully"
            );
          }

          // Build args if we haven't built yet (Mode 1 or Mode 2)
          if (!args) {
            args = buildArgs();
          }

          // Ensure output directory exists
          const outputDirPath: string = path.dirname(outputFile);
          if (!fs.existsSync(outputDirPath)) {
            fs.mkdirSync(outputDirPath, { recursive: true });
          }

          // Try to run FFmpeg directly
          try {
            const ffmpegProc: ChildProcess = spawn(ffmpegPath, args, {
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            });

            let stderrOutput = "";
            let stdoutOutput = "";

            ffmpegProc.stdout?.on("data", (chunk: Buffer) => {
              stdoutOutput += chunk.toString();
            });

            ffmpegProc.stderr?.on("data", (chunk: Buffer) => {
              const text: string = chunk.toString();
              stderrOutput += text;

              const progress: FFmpegProgress | null = parseProgress(text);
              if (progress) {
                event.sender?.send?.("ffmpeg-progress", progress);
              }
            });

            ffmpegProc.on("error", (err: Error) => {
              reject(err);
            });

            ffmpegProc.on(
              "close",
              (code: number | null, signal: string | null) => {
                if (code === 0) {
                  resolve({
                    success: true,
                    outputFile,
                    method: "spawn",
                  });
                } else {
                  const error: FFmpegError = new Error(
                    `FFmpeg exited with code ${code}`
                  ) as FFmpegError;
                  error.code = code || undefined;
                  error.signal = signal || undefined;
                  error.stderr = stderrOutput;
                  error.stdout = stdoutOutput;
                  reject(error);
                }
              }
            );

            return;
          } catch {
            // Direct spawn failed
          }

          // Fallback: Manual export instructions
          const inputPattern: string = path.join(frameDir, "frame-%04d.png");
          reject(
            new Error(
              `FFmpeg process spawning restricted. Please run manually:\n\nffmpeg -y -framerate 30 -i "${inputPattern}" -c:v libx264 -preset fast -crf 23 -t 5 -pix_fmt yuv420p "${outputFile}"`
            )
          );
        })().catch(reject);
      });
    }
  );
}

/** Execute an FFmpeg command, streaming progress events to the renderer. */
async function runFFmpegCommand({
  args,
  event,
  ffmpegPath,
}: {
  args: string[];
  event?: IpcMainInvokeEvent;
  ffmpegPath: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrOutput = "";
    process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      if (event) {
        const progress = parseProgress(text);
        if (progress) {
          event.sender?.send?.("ffmpeg-progress", progress);
        }
      }
    });

    process.on("error", (error: Error) => {
      reject(error);
    });

    process.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `FFmpeg failed with code ${code}. ${stderrOutput.slice(-5000)}`
        )
      );
    });
  });
}

/**
 * Remap an original-timeline time to the post-cut output timeline.
 * Walks through keep segments and accumulates output duration.
 */
function remapTimeForCutSegments(
  originalTime: number,
  keepSegments: Array<{ start: number; end: number }>
): number {
  let outputTime = 0;
  for (const seg of keepSegments) {
    if (originalTime <= seg.start) break;
    if (originalTime >= seg.end) {
      outputTime += seg.end - seg.start;
    } else {
      outputTime += originalTime - seg.start;
      break;
    }
  }
  return outputTime;
}

/**
 * Build FFmpeg args for a sticker overlay pass on an already-cut video.
 * Returns null if no valid stickers to overlay.
 */
function buildStickerOverlayPass(
  inputVideoPath: string,
  outputPath: string,
  stickerSources: import("./ffmpeg/types").StickerSource[],
  keepSegments: Array<{ start: number; end: number }>
): string[] | null {
  // Remap sticker timing and filter out stickers with zero duration
  const remapped = stickerSources
    .map((sticker) => ({
      ...sticker,
      startTime: remapTimeForCutSegments(sticker.startTime, keepSegments),
      endTime: remapTimeForCutSegments(sticker.endTime, keepSegments),
    }))
    .filter((s) => s.endTime > s.startTime);

  if (remapped.length === 0) return null;

  // Validate all sticker files exist
  const validStickers = remapped.filter((s) => fs.existsSync(s.path));
  if (validStickers.length === 0) return null;

  const args: string[] = ["-y", "-i", inputVideoPath];

  // Add sticker inputs
  for (const sticker of validStickers) {
    args.push("-loop", "1", "-i", sticker.path);
  }

  // Build filter_complex
  const filterSteps: string[] = [];
  let currentVideoLabel = "0:v";
  let filterIdx = 0;

  for (const [index, sticker] of validStickers.entries()) {
    const inputIdx = 1 + index;
    const scaledLabel = `sticker_scaled_${index}`;
    let preparedLabel = scaledLabel;

    if (sticker.maintainAspectRatio) {
      const padLabel = `sticker_pad_${index}`;
      filterSteps.push(
        `[${inputIdx}:v]scale=${sticker.width}:${sticker.height}:force_original_aspect_ratio=decrease[${scaledLabel}]`
      );
      filterSteps.push(
        `[${scaledLabel}]pad=${sticker.width}:${sticker.height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[${padLabel}]`
      );
      preparedLabel = padLabel;
    } else {
      filterSteps.push(
        `[${inputIdx}:v]scale=${sticker.width}:${sticker.height}[${scaledLabel}]`
      );
    }

    if ((sticker.rotation ?? 0) !== 0) {
      const rotatedLabel = `sticker_rotated_${index}`;
      filterSteps.push(
        `[${preparedLabel}]rotate=${sticker.rotation}*PI/180:c=none[${rotatedLabel}]`
      );
      preparedLabel = rotatedLabel;
    }

    if ((sticker.opacity ?? 1) < 1) {
      const alphaLabel = `sticker_alpha_${index}`;
      filterSteps.push(
        `[${preparedLabel}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${sticker.opacity}*alpha(X,Y)'[${alphaLabel}]`
      );
      preparedLabel = alphaLabel;
    }

    const outputLabel = `v_sticker_${filterIdx++}`;
    filterSteps.push(
      `[${currentVideoLabel}][${preparedLabel}]overlay=x=${sticker.x}:y=${sticker.y}:enable='between(t,${sticker.startTime},${sticker.endTime})'[${outputLabel}]`
    );
    currentVideoLabel = outputLabel;
  }

  args.push(
    "-filter_complex",
    filterSteps.join(";"),
    "-map",
    `[${currentVideoLabel}]`,
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath
  );

  return args;
}

/** Export using filter_complex to cut and concatenate word-filter segments. */
async function handleWordFilterCut({
  options,
  ffmpegPath,
  outputFile,
  event,
  resolve,
  reject,
}: {
  options: ExportOptions;
  ffmpegPath: string;
  outputFile: string;
  event: IpcMainInvokeEvent;
  resolve: (value: ExportResult) => void;
  reject: (reason: Error) => void;
}): Promise<void> {
  try {
    if (!options.videoInputPath) {
      throw new Error(
        "Word filter cut mode requires useVideoInput with videoInputPath."
      );
    }

    if (!fs.existsSync(options.videoInputPath)) {
      throw new Error(`Video input not found: ${options.videoInputPath}`);
    }

    const keepSegments = options.wordFilterSegments || [];
    if (keepSegments.length === 0) {
      throw new Error("No keep segments provided for word filter cut.");
    }

    const trimStart = options.trimStart ?? 0;
    const adjustedSegments =
      trimStart > 0
        ? keepSegments
            .map((seg) => ({
              start: Math.max(0, seg.start - trimStart),
              end: Math.max(0, seg.end - trimStart),
            }))
            .filter((seg) => seg.end > seg.start)
        : keepSegments;

    const hasStickers =
      options.stickerSources && options.stickerSources.length > 0;

    console.log(
      `🎬 [WORD FILTER CUT] Starting word filter cut — ${adjustedSegments.length} segments`
    );
    if (hasStickers) {
      console.log(
        `🎬 [WORD FILTER CUT] Will overlay ${options.stickerSources!.length} sticker(s) after cut (2-pass)`
      );
    }

    // Determine output target: if stickers exist, cut to temp file first
    const cutOutputFile = hasStickers
      ? path.join(path.dirname(outputFile), "word-cut-intermediate.mp4")
      : outputFile;

    if (adjustedSegments.length > 100) {
      console.log(
        `🎬 [WORD FILTER CUT] Using fallback concat (${adjustedSegments.length} segments > 100)`
      );
      await handleWordFilterCutFallback({
        ffmpegPath,
        videoPath: options.videoInputPath,
        outputFile: cutOutputFile,
        keepSegments: adjustedSegments,
        event,
      });
    } else {
      console.log(
        `🎬 [WORD FILTER CUT] Pass 1: Cutting ${adjustedSegments.length} segments with filter_complex...`
      );
      const probe = await probeVideoFile(options.videoInputPath);
      const { filterComplex, outputMaps } = buildFilterCutComplex({
        keepSegments: adjustedSegments,
        hasAudio: probe.hasAudio,
      });

      const args: string[] = ["-y"];
      if (trimStart > 0) {
        args.push("-ss", String(trimStart));
      }
      args.push(
        "-i",
        options.videoInputPath,
        "-filter_complex",
        filterComplex,
        ...outputMaps,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        cutOutputFile
      );

      await runFFmpegCommand({
        args,
        event,
        ffmpegPath,
      });
    }

    // Pass 2: Overlay stickers onto the cut video (with remapped timing)
    if (hasStickers && options.stickerSources) {
      console.log(
        `🎨 [WORD FILTER CUT] Pass 2: Overlaying ${options.stickerSources.length} sticker(s) onto cut video...`
      );
      debugLog(
        `[WordFilterCut] Applying ${options.stickerSources.length} sticker overlays to cut video`
      );

      const stickerArgs = buildStickerOverlayPass(
        cutOutputFile,
        outputFile,
        options.stickerSources,
        adjustedSegments
      );

      if (stickerArgs) {
        await runFFmpegCommand({
          args: stickerArgs,
          event,
          ffmpegPath,
        });
        console.log(
          "🎨 [WORD FILTER CUT] Sticker overlay pass complete"
        );

        // Clean up intermediate file
        try {
          fs.unlinkSync(cutOutputFile);
        } catch {
          // Ignore cleanup errors
        }
      } else {
        console.log(
          "🎨 [WORD FILTER CUT] No visible stickers after timing remap — skipping overlay pass"
        );
        // No valid stickers after remapping — rename intermediate to final
        fs.renameSync(cutOutputFile, outputFile);
      }
    }

    resolve({
      success: true,
      outputFile,
      method: "spawn",
    });
  } catch (error) {
    reject(error as Error);
  }
}

/** Fallback export: cut individual segments then concat via demuxer. */
async function handleWordFilterCutFallback({
  ffmpegPath,
  videoPath,
  outputFile,
  keepSegments,
  event,
}: {
  ffmpegPath: string;
  videoPath: string;
  outputFile: string;
  keepSegments: Array<{ start: number; end: number }>;
  event: IpcMainInvokeEvent;
}): Promise<void> {
  const outputDir = path.dirname(outputFile);
  const segmentDir = path.join(outputDir, "word-cut-segments");
  if (!fs.existsSync(segmentDir)) {
    fs.mkdirSync(segmentDir, { recursive: true });
  }

  const segmentPaths = keepSegments.map((_, index) =>
    path.join(segmentDir, `segment-${String(index).padStart(4, "0")}.mp4`)
  );

  await keepSegments.reduce(async (previousPromise, segment, index) => {
    await previousPromise;
    const duration = Math.max(0, segment.end - segment.start);
    const args = [
      "-y",
      "-ss",
      String(segment.start),
      "-t",
      String(duration),
      "-i",
      videoPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      segmentPaths[index],
    ];
    await runFFmpegCommand({
      args,
      event,
      ffmpegPath,
    });
  }, Promise.resolve());

  const concatListPath = path.join(segmentDir, "concat-list.txt");
  const concatContent = segmentPaths
    .map((segmentPath) => {
      const escapedPath = segmentPath
        .replace(/\\/g, "/")
        .replace(/'/g, "'\\''");
      return `file '${escapedPath}'`;
    })
    .join("\n");
  fs.writeFileSync(concatListPath, concatContent, "utf8");

  await runFFmpegCommand({
    args: [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputFile,
    ],
    event,
    ffmpegPath,
  });
}

/**
 * Handles Mode 1.5: Video Normalization with FFmpeg Padding.
 * Normalizes all video sources, concatenates them, and optionally mixes audio.
 */
async function handleMode1_5(
  options: ExportOptions,
  ffmpegPath: string,
  frameDir: string,
  outputFile: string,
  width: number,
  height: number,
  fps: number,
  audioFiles: import("./ffmpeg/types").AudioFile[],
  event: IpcMainInvokeEvent,
  resolve: (value: ExportResult) => void,
  reject: (reason: Error) => void
): Promise<void> {
  console.log(
    "⚡ [MODE 1.5 EXPORT] ============================================"
  );
  console.log(
    "⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding"
  );
  console.log(
    `⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`
  );
  console.log(`⚡ [MODE 1.5 EXPORT] Target resolution: ${width}x${height}`);
  console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${fps}`);
  console.log("⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3");
  console.log(
    "⚡ [MODE 1.5 EXPORT] ============================================"
  );

  try {
    // Validate video sources exist
    if (!options.videoSources || options.videoSources.length === 0) {
      const error = "Mode 1.5 requires video sources but none provided";
      console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
      reject(new Error(error));
      return;
    }

    // Validate each video source file exists before processing
    for (let i = 0; i < options.videoSources.length; i++) {
      const source = options.videoSources[i];
      if (!fs.existsSync(source.path)) {
        const error = `Video source ${i + 1} not found: ${source.path}`;
        console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
        reject(new Error(error));
        return;
      }
    }

    console.log(
      `⚡ [MODE 1.5 EXPORT] ✅ All ${options.videoSources.length} video sources validated`
    );

    // Step 1: Normalize all videos to target resolution and fps
    console.log(
      `⚡ [MODE 1.5 EXPORT] Step 1/3: Normalizing ${options.videoSources.length} videos...`
    );
    const normalizedPaths: string[] = [];

    for (let i = 0; i < options.videoSources.length; i++) {
      const source = options.videoSources[i];
      const normalizedPath = path.join(frameDir, `normalized_video_${i}.mp4`);

      console.log(
        `⚡ [MODE 1.5 EXPORT] Normalizing video ${i + 1}/${options.videoSources.length}...`
      );
      console.log(
        `⚡ [MODE 1.5 EXPORT]   Source: ${path.basename(source.path)}`
      );
      console.log(
        `⚡ [MODE 1.5 EXPORT]   Expected duration: ${source.duration}s`
      );
      console.log(
        `⚡ [MODE 1.5 EXPORT]   Trim: start=${source.trimStart || 0}s, end=${source.trimEnd || 0}s`
      );

      // Call normalizeVideo function from utils
      await normalizeVideo(
        source.path,
        normalizedPath,
        width,
        height,
        fps,
        source.duration,
        source.trimStart || 0,
        source.trimEnd || 0
      );

      normalizedPaths.push(normalizedPath);
      console.log(
        `⚡ [MODE 1.5 EXPORT] ✅ Video ${i + 1}/${options.videoSources.length} normalized`
      );
    }

    console.log("⚡ [MODE 1.5 EXPORT] All videos normalized successfully");

    // Step 2/3: Create concat list file for FFmpeg concat demuxer
    console.log("⚡ [MODE 1.5 EXPORT] Step 2/3: Creating concat list...");
    const concatListPath = path.join(frameDir, "concat-list.txt");

    // Escape Windows backslashes for FFmpeg concat file format
    const concatContent = normalizedPaths
      .map((p) => {
        const escapedPath = p.replace(/\\/g, "/").replace(/'/g, "'\\''");
        return `file '${escapedPath}'`;
      })
      .join("\n");

    fs.writeFileSync(concatListPath, concatContent, "utf-8");
    console.log(
      `⚡ [MODE 1.5 EXPORT] ✅ Concat list created: ${normalizedPaths.length} videos`
    );

    // Step 3/3: Concatenate normalized videos using FFmpeg concat demuxer
    console.log(
      `⚡ [MODE 1.5 EXPORT] Step 3/3: Concatenating ${normalizedPaths.length} normalized videos...`
    );

    const concatArgs: string[] = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputFile,
    ];

    console.log(
      `⚡ [MODE 1.5 EXPORT] FFmpeg concat command: ffmpeg ${concatArgs.join(" ")}`
    );

    // Execute concat with progress monitoring
    await new Promise<void>((concatResolve, concatReject) => {
      const concatProcess: ChildProcess = spawn(ffmpegPath, concatArgs, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let concatStderr = "";

      concatProcess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        concatStderr += text;

        const progress: FFmpegProgress | null = parseProgress(text);
        if (progress) {
          event.sender?.send?.("ffmpeg-progress", progress);
        }
      });

      concatProcess.on("close", (code: number | null) => {
        if (code === 0) {
          if (fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            console.log("⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!");
            console.log(
              `⚡ [MODE 1.5 EXPORT] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
            );
            concatResolve();
          } else {
            concatReject(new Error(`Output file not created: ${outputFile}`));
          }
        } else {
          console.error(
            `❌ [MODE 1.5 EXPORT] Concatenation failed with code ${code}`
          );
          console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${concatStderr}`);
          concatReject(new Error(`FFmpeg concat failed with code ${code}`));
        }
      });

      concatProcess.on("error", (err: Error) => {
        console.error("❌ [MODE 1.5 EXPORT] FFmpeg process error:", err);
        concatReject(err);
      });
    });

    // Mix overlay audio files into the concatenated output if present
    if (audioFiles && audioFiles.length > 0) {
      await mixOverlayAudio(ffmpegPath, frameDir, outputFile, audioFiles);
    }

    // Success!
    console.log(
      "⚡ [MODE 1.5 EXPORT] ============================================"
    );
    console.log("⚡ [MODE 1.5 EXPORT] ✅ Export complete!");
    console.log(`⚡ [MODE 1.5 EXPORT] Output: ${outputFile}`);
    console.log(
      "⚡ [MODE 1.5 EXPORT] ============================================"
    );

    resolve({
      success: true,
      outputFile,
      method: "spawn",
    });
  } catch (error: any) {
    console.error(
      "❌ [MODE 1.5 EXPORT] ============================================"
    );
    console.error(
      "❌ [MODE 1.5 EXPORT] Normalization failed - no fallback available"
    );
    console.error("❌ [MODE 1.5 EXPORT] Error:", error.message || error);
    console.error(
      "❌ [MODE 1.5 EXPORT] ============================================"
    );

    reject(error);
  }
}

/**
 * Mixes overlay audio files into the concatenated video output.
 * Uses adelay for per-file timing and amix for multiple audio streams.
 */
async function mixOverlayAudio(
  ffmpegPath: string,
  frameDir: string,
  outputFile: string,
  audioFiles: import("./ffmpeg/types").AudioFile[]
): Promise<void> {
  console.log(
    `🎧 [MODE 1.5 EXPORT] Mixing ${audioFiles.length} overlay audio file(s) into output...`
  );

  const concatOutputTemp = path.join(frameDir, "concat_before_audio.mp4");
  // Rename current output to temp so we can mix into final output
  fs.renameSync(outputFile, concatOutputTemp);

  // Build FFmpeg inputs: video + each audio file
  const mixArgs: string[] = ["-y", "-i", concatOutputTemp];
  for (const af of audioFiles) {
    mixArgs.push("-i", af.path);
  }

  // Check if the concat output has an audio stream
  const hasBaseAudio = await new Promise<boolean>((resolve) => {
    const probePath = getFFprobePath();
    const probe = spawn(
      probePath,
      [
        "-v",
        "quiet",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        concatOutputTemp,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    probe.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    probe.on("close", () => resolve(stdout.trim().length > 0));
    probe.on("error", () => resolve(false));
  });

  // Build filter_complex for audio mixing
  const filterParts: string[] = [];
  const mixInputLabels: string[] = [];

  if (hasBaseAudio) {
    mixInputLabels.push("[0:a]"); // base video audio
  } else {
    console.log(
      "🔇 [MODE 1.5 EXPORT] No base audio stream — mixing overlays only"
    );
  }

  for (let i = 0; i < audioFiles.length; i++) {
    const af = audioFiles[i];
    const delayMs = Math.round((af.startTime ?? 0) * 1000);
    const vol = af.volume ?? 1.0;
    const label = `[oa${i}]`;
    filterParts.push(
      `[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=${vol}${label}`
    );
    mixInputLabels.push(label);
  }

  // Use "first" duration when base audio sets the length, "longest" otherwise
  const amixDuration = hasBaseAudio ? "first" : "longest";
  const mixInputCount = mixInputLabels.length;
  filterParts.push(
    `${mixInputLabels.join("")}amix=inputs=${mixInputCount}:duration=${amixDuration}:dropout_transition=0[aout]`
  );

  mixArgs.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputFile
  );

  console.log(
    `🎧 [MODE 1.5 EXPORT] Audio mix command: ffmpeg ${mixArgs.join(" ")}`
  );

  await new Promise<void>((mixResolve, mixReject) => {
    const mixProcess: ChildProcess = spawn(ffmpegPath, mixArgs, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let mixStderr = "";

    mixProcess.stderr?.on("data", (chunk: Buffer) => {
      mixStderr += chunk.toString();
    });

    mixProcess.on("close", (code: number | null) => {
      if (code === 0) {
        console.log("🎧 [MODE 1.5 EXPORT] ✅ Audio mixing complete!");
        // Clean up temp file
        try {
          fs.unlinkSync(concatOutputTemp);
        } catch {
          // ignore cleanup errors
        }
        mixResolve();
      } else {
        console.error(
          `❌ [MODE 1.5 EXPORT] Audio mixing failed with code ${code}`
        );
        console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${mixStderr}`);
        // Restore original concat output (without overlay audio)
        try {
          fs.renameSync(concatOutputTemp, outputFile);
        } catch {
          // ignore restore errors
        }
        console.warn(
          "⚠️ [MODE 1.5 EXPORT] Falling back to output without overlay audio"
        );
        mixResolve(); // Don't reject — export with embedded audio only
      }
    });

    mixProcess.on("error", (err: Error) => {
      console.error("❌ [MODE 1.5 EXPORT] Audio mix process error:", err);
      // Restore original concat output
      try {
        fs.renameSync(concatOutputTemp, outputFile);
      } catch {
        // ignore restore errors
      }
      console.warn(
        "⚠️ [MODE 1.5 EXPORT] Falling back to output without overlay audio"
      );
      mixResolve(); // Don't reject — graceful fallback
    });
  });
}
