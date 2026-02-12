/**
 * FFmpeg Argument Builder
 *
 * Pure function that constructs FFmpeg command-line argument arrays.
 * No IPC or Electron dependencies — takes a config, returns string[].
 *
 * Location: electron/ffmpeg-args-builder.ts
 */

import path from "path";
import fs from "fs";

import type {
  AudioFile,
  VideoSource,
  StickerSource,
  QualitySettings,
} from "./ffmpeg/types";

import { QUALITY_SETTINGS, debugLog, debugWarn } from "./ffmpeg/utils";

/**
 * Constructs FFmpeg command-line arguments for video export.
 *
 * Supports three modes:
 * - Mode 1: Direct copy (fast, lossless concat) for sequential videos
 * - Mode 1.5: Video normalization (handled by normalizeVideo utility)
 * - Mode 2: Direct video with FFmpeg filters for text/stickers/effects
 */
export function buildFFmpegArgs(
  inputDir: string,
  outputFile: string,
  width: number,
  height: number,
  fps: number,
  quality: "high" | "medium" | "low",
  duration: number,
  audioFiles: AudioFile[] = [],
  filterChain?: string,
  textFilterChain?: string,
  useDirectCopy = false,
  videoSources?: VideoSource[],
  stickerFilterChain?: string,
  stickerSources?: StickerSource[],
  useVideoInput = false,
  videoInputPath?: string,
  trimStart?: number,
  trimEnd?: number
): string[] {
  const { crf, preset }: QualitySettings =
    QUALITY_SETTINGS[quality] || QUALITY_SETTINGS.medium;

  // =============================================================================
  // MODE 2: Direct video input with FFmpeg filters (text/stickers)
  // =============================================================================
  if (useVideoInput && videoInputPath) {
    console.log("⚡ [MODE 2] ============================================");
    console.log("⚡ [MODE 2] Entering Mode 2: Direct video input with filters");
    console.log(`⚡ [MODE 2] Video input path: ${videoInputPath}`);
    debugLog("[FFmpeg] MODE 2: Using direct video input with filters");
    const args: string[] = ["-y"];

    if (!fs.existsSync(videoInputPath)) {
      throw new Error(`Video source not found: ${videoInputPath}`);
    }

    if (trimStart && trimStart > 0) {
      args.push("-ss", trimStart.toString());
    }

    args.push("-i", videoInputPath);

    if (duration) {
      args.push("-t", duration.toString());
    }

    // Add sticker image inputs
    if (stickerSources && stickerSources.length > 0) {
      for (const sticker of stickerSources) {
        if (!fs.existsSync(sticker.path)) {
          debugWarn(`[FFmpeg] Sticker file not found: ${sticker.path}`);
          continue;
        }
        args.push("-loop", "1", "-i", sticker.path);
      }
    }

    // Build complete filter chain
    const filters: string[] = [];

    if (filterChain) {
      filters.push(filterChain);
    }

    if (stickerFilterChain) {
      filters.push(stickerFilterChain);
    }

    if (textFilterChain) {
      filters.push(textFilterChain);
    }

    if (filters.length > 0) {
      if (stickerSources && stickerSources.length > 0) {
        args.push("-filter_complex", filters.join(";"));
      } else {
        args.push("-vf", filters.join(","));
      }
    }

    // Add audio inputs and mixing
    const stickerCount = stickerSources?.length || 0;
    if (audioFiles && audioFiles.length > 0) {
      for (const audioFile of audioFiles) {
        if (!fs.existsSync(audioFile.path)) {
          throw new Error(`Audio file not found: ${audioFile.path}`);
        }
        args.push("-i", audioFile.path);
      }

      if (audioFiles.length === 1) {
        const audioFile = audioFiles[0];
        const audioInputIndex = 1 + stickerCount;
        if (audioFile.startTime > 0) {
          args.push(
            "-filter_complex",
            `[${audioInputIndex}:a]adelay=${Math.round(audioFile.startTime * 1000)}|${Math.round(audioFile.startTime * 1000)}[audio]`,
            "-map",
            "0:v",
            "-map",
            "[audio]"
          );
        } else {
          args.push("-map", "0:v", "-map", `${audioInputIndex}:a`);
        }
      } else {
        const inputMaps: string[] = audioFiles.map(
          (_, i) => `[${i + 1 + stickerCount}:a]`
        );
        const mixFilter = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;
        args.push(
          "-filter_complex",
          mixFilter,
          "-map",
          "0:v",
          "-map",
          "[audio]"
        );
      }
      args.push("-c:a", "aac", "-b:a", "128k");
    }

    args.push("-c:v", "libx264");
    args.push("-preset", preset);
    args.push("-crf", crf);
    args.push("-pix_fmt", "yuv420p");
    args.push("-movflags", "+faststart");
    args.push(outputFile);

    console.log("⚡ [MODE 2] ✅ FFmpeg args built successfully");
    console.log("⚡ [MODE 2] ============================================");
    return args;
  }

  // =============================================================================
  // MODE 1: Direct copy for single/multiple videos
  // =============================================================================
  if (useDirectCopy && videoSources && videoSources.length > 0) {
    const args: string[] = ["-y"];

    if (videoSources.length === 1) {
      const video = videoSources[0];

      if (!fs.existsSync(video.path)) {
        throw new Error(`Video source not found: ${video.path}`);
      }

      const effectiveDuration =
        video.duration - (video.trimStart || 0) - (video.trimEnd || 0);

      if (video.trimStart && video.trimStart > 0) {
        args.push("-ss", video.trimStart.toString());
      }

      args.push("-i", video.path);

      if (video.duration) {
        args.push("-t", effectiveDuration.toString());
      }

      // Add audio inputs if provided
      if (audioFiles && audioFiles.length > 0) {
        for (const audioFile of audioFiles) {
          if (!fs.existsSync(audioFile.path)) {
            throw new Error(`Audio file not found: ${audioFile.path}`);
          }
          args.push("-i", audioFile.path);
        }

        if (audioFiles.length === 1) {
          const audioFile = audioFiles[0];
          if (audioFile.startTime > 0) {
            args.push(
              "-filter_complex",
              `[1:a]adelay=${Math.round(audioFile.startTime * 1000)}|${Math.round(audioFile.startTime * 1000)}[audio]`,
              "-map",
              "0:v",
              "-map",
              "[audio]"
            );
          } else {
            args.push("-map", "0:v", "-map", "1:a");
          }
        } else {
          const inputMaps: string[] = audioFiles.map((_, i) => `[${i + 1}:a]`);
          const mixFilter = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;
          args.push(
            "-filter_complex",
            mixFilter,
            "-map",
            "0:v",
            "-map",
            "[audio]"
          );
        }
        args.push("-c:a", "aac", "-b:a", "128k");
      }

      args.push("-c:v", "copy");
    } else {
      // Multiple videos: use concat demuxer
      const concatFileContent = videoSources
        .map((video) => {
          if (!fs.existsSync(video.path)) {
            throw new Error(`Video source not found: ${video.path}`);
          }

          if (
            (video.trimStart && video.trimStart > 0) ||
            (video.trimEnd && video.trimEnd > 0)
          ) {
            throw new Error(
              `Video '${path.basename(video.path)}' has trim values. Use Mode 1.5 for trimmed multi-video exports.`
            );
          }

          const escapedPath = video.path.replace(/'/g, "'\\''");
          return `file '${escapedPath}'`;
        })
        .join("\n");

      const concatFilePath = path.join(inputDir, "concat-list.txt");
      fs.writeFileSync(concatFilePath, concatFileContent);

      args.push("-f", "concat", "-safe", "0", "-i", concatFilePath);

      if (audioFiles && audioFiles.length > 0) {
        for (const audioFile of audioFiles) {
          if (!fs.existsSync(audioFile.path)) {
            throw new Error(`Audio file not found: ${audioFile.path}`);
          }
          args.push("-i", audioFile.path);
        }

        const audioInputOffset = 1;
        const inputMaps: string[] = audioFiles.map(
          (_, i) => `[${i + audioInputOffset}:a]`
        );
        const mixFilter = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;

        args.push(
          "-filter_complex",
          mixFilter,
          "-map",
          "0:v",
          "-map",
          "[audio]"
        );
        args.push("-c:a", "aac", "-b:a", "128k");
      }

      args.push("-c:v", "copy");
    }

    args.push("-movflags", "+faststart", outputFile);

    return args;
  }

  // If we reach here, something is wrong
  throw new Error(
    "Invalid export configuration. Expected Mode 1, Mode 1.5, or Mode 2."
  );
}
