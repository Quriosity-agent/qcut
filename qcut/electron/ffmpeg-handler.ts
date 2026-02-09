/**
 * FFmpeg IPC Handler
 *
 * Registers all FFmpeg-related IPC handlers for video export operations.
 * Uses extracted utilities from ./ffmpeg/ for cleaner organization.
 */

import { ipcMain, app, shell, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { TempManager, ExportSession } from "./temp-manager.js";

// Import types from ffmpeg module (both internal use and re-exported)
import type {
  VideoSource,
  FrameProcessOptions,
  QualitySettings,
  QualityMap,
  FFmpegError,
  VideoProbeResult,
  AudioFile,
  StickerSource,
  ExportOptions,
  FrameData,
  ExportResult,
  FFmpegProgress,
  OpenFolderResult,
  ExtractAudioOptions,
  ExtractAudioResult,
  FFmpegHealthResult,
} from "./ffmpeg/types";

// Re-export types for external use (using export from)
export type {
  AudioFile,
  StickerSource,
  ExportOptions,
  FrameData,
  ExportResult,
  FFmpegProgress,
  OpenFolderResult,
  ExtractAudioOptions,
  ExtractAudioResult,
} from "./ffmpeg/types";

// Import utilities from ffmpeg module
import {
  MAX_EXPORT_DURATION,
  QUALITY_SETTINGS,
  debugLog,
  debugWarn,
  debugError,
  getFFmpegPath,
  getFFprobePath,
  parseProgress,
  probeVideoFile,
  normalizeVideo,
  verifyFFmpegBinary,
} from "./ffmpeg/utils";

const tempManager = new TempManager();

/** Cached health check promise — ensures verifyFFmpegBinary() runs only once */
let healthCheckPromise: Promise<FFmpegHealthResult> | null = null;

function getFFmpegHealth(): Promise<FFmpegHealthResult> {
  if (!healthCheckPromise) {
    healthCheckPromise = verifyFFmpegBinary().catch((error) => {
      console.error("[FFmpeg Health] Health check failed:", error);
      return {
        ffmpegOk: false,
        ffprobeOk: false,
        ffmpegVersion: "",
        ffprobeVersion: "",
        ffmpegPath: "",
        ffprobePath: "",
        errors: [String(error)],
      };
    });
  }
  return healthCheckPromise;
}

/**
 * Kicks off FFmpeg/FFprobe health check and caches the promise.
 * Called at startup from main.ts — async, non-blocking.
 */
export function initFFmpegHealthCheck(): void {
  getFFmpegHealth();
}

/**
 * Registers all FFmpeg-related IPC handlers for video export operations.
 *
 * Must be called during Electron main process initialization; handlers
 * won't be available to renderer process until registered.
 */
export function setupFFmpegIPC(): void {
  // Handle ffmpeg-path request
  ipcMain.handle("ffmpeg-path", async (): Promise<string> => {
    return getFFmpegPath();
  });

  // Handle ffmpeg health check request
  ipcMain.handle("ffmpeg-health", (): Promise<FFmpegHealthResult> => {
    return getFFmpegHealth();
  });

  // Create export session
  ipcMain.handle("create-export-session", async (): Promise<ExportSession> => {
    return tempManager.createExportSession();
  });

  // Save frame to disk
  ipcMain.handle(
    "save-frame",
    async (
      event: IpcMainInvokeEvent,
      { sessionId, frameName, data }: FrameData
    ): Promise<string> => {
      const frameDir: string = tempManager.getFrameDir(sessionId);
      const framePath: string = path.join(frameDir, frameName);
      const buffer: Buffer = Buffer.from(data, "base64");

      // Validate buffer
      if (!buffer || buffer.length < 100) {
        throw new Error(`Invalid PNG buffer: ${buffer.length} bytes`);
      }

      // Check PNG signature (first 8 bytes should be PNG signature)
      const pngSignature: Buffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      if (!buffer.subarray(0, 8).equals(pngSignature)) {
        // Warning: Invalid PNG signature
      }

      fs.writeFileSync(framePath, buffer);

      return framePath;
    }
  );

  // Read output file
  ipcMain.handle(
    "read-output-file",
    async (event: IpcMainInvokeEvent, outputPath: string): Promise<Buffer> => {
      return fs.readFileSync(outputPath);
    }
  );

  // Cleanup export session
  ipcMain.handle(
    "cleanup-export-session",
    async (event: IpcMainInvokeEvent, sessionId: string): Promise<void> => {
      tempManager.cleanup(sessionId);
    }
  );

  // Open frames folder in file explorer
  ipcMain.handle(
    "open-frames-folder",
    async (
      event: IpcMainInvokeEvent,
      sessionId: string
    ): Promise<OpenFolderResult> => {
      const frameDir: string = tempManager.getFrameDir(sessionId);
      await shell.openPath(frameDir);
      return { success: true, path: frameDir };
    }
  );

  // Export video with CLI
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
          buildFFmpegArgs(
            frameDir,
            outputFile,
            width,
            height,
            fps,
            quality,
            validatedDuration,
            audioFiles,
            options.filterChain,
            textFilterChain,
            effectiveUseDirectCopy,
            options.videoSources,
            stickerFilterChain,
            stickerSources,
            options.useVideoInput || false,
            options.videoInputPath,
            options.trimStart,
            options.trimEnd
          );

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
            console.log(
              "⚡ [MODE 1.5 EXPORT] ============================================"
            );
            console.log(
              "⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding"
            );
            console.log(
              `⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`
            );
            console.log(
              `⚡ [MODE 1.5 EXPORT] Target resolution: ${width}x${height}`
            );
            console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${fps}`);
            console.log(
              "⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3"
            );
            console.log(
              "⚡ [MODE 1.5 EXPORT] ============================================"
            );

            try {
              // Validate video sources exist
              if (!options.videoSources || options.videoSources.length === 0) {
                const error =
                  "Mode 1.5 requires video sources but none provided";
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
                const normalizedPath = path.join(
                  frameDir,
                  `normalized_video_${i}.mp4`
                );

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

              console.log(
                "⚡ [MODE 1.5 EXPORT] All videos normalized successfully"
              );

              // Step 2/3: Create concat list file for FFmpeg concat demuxer
              console.log(
                "⚡ [MODE 1.5 EXPORT] Step 2/3: Creating concat list..."
              );
              const concatListPath = path.join(frameDir, "concat-list.txt");

              // Escape Windows backslashes for FFmpeg concat file format
              const concatContent = normalizedPaths
                .map((p) => {
                  const escapedPath = p
                    .replace(/'/g, "'\\''")
                    .replace(/\\/g, "/");
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
                const concatProcess: ChildProcess = spawn(
                  ffmpegPath,
                  concatArgs,
                  {
                    windowsHide: true,
                    stdio: ["ignore", "pipe", "pipe"],
                  }
                );

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
                      console.log(
                        "⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!"
                      );
                      console.log(
                        `⚡ [MODE 1.5 EXPORT] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
                      );
                      concatResolve();
                    } else {
                      concatReject(
                        new Error(`Output file not created: ${outputFile}`)
                      );
                    }
                  } else {
                    console.error(
                      `❌ [MODE 1.5 EXPORT] Concatenation failed with code ${code}`
                    );
                    console.error(
                      `❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${concatStderr}`
                    );
                    concatReject(
                      new Error(`FFmpeg concat failed with code ${code}`)
                    );
                  }
                });

                concatProcess.on("error", (err: Error) => {
                  console.error(
                    "❌ [MODE 1.5 EXPORT] FFmpeg process error:",
                    err
                  );
                  concatReject(err);
                });
              });

              // TODO: Audio mixing not yet implemented for Mode 1.5
              if (audioFiles && audioFiles.length > 0) {
                console.warn(
                  "⚠️ [MODE 1.5 EXPORT] Audio mixing not yet implemented for Mode 1.5"
                );
                throw new Error(
                  "Audio mixing not supported in Mode 1.5 - falling back to Mode 3"
                );
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

              return;
            } catch (error: any) {
              console.error(
                "❌ [MODE 1.5 EXPORT] ============================================"
              );
              console.error(
                "❌ [MODE 1.5 EXPORT] Normalization failed - no fallback available"
              );
              console.error(
                "❌ [MODE 1.5 EXPORT] Error:",
                error.message || error
              );
              console.error(
                "❌ [MODE 1.5 EXPORT] ============================================"
              );

              reject(error);
              return;
            }
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
                  resolve({ success: true, outputFile, method: "spawn" });
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
          } catch (spawnErr: any) {
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

  // Validate filter chain
  ipcMain.handle(
    "validate-filter-chain",
    async (
      event: IpcMainInvokeEvent,
      filterChain: string
    ): Promise<boolean> => {
      try {
        const ffmpegPath = getFFmpegPath();

        const result = await new Promise<boolean>((resolve) => {
          const ffmpeg = spawn(
            ffmpegPath,
            [
              "-f",
              "lavfi",
              "-i",
              "testsrc2=duration=0.1:size=32x32:rate=1",
              "-vf",
              filterChain,
              "-f",
              "null",
              "-",
            ],
            {
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            }
          );

          let settled = false;
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(ok);
          };

          ffmpeg.on("close", (code) => {
            finish(code === 0);
          });

          ffmpeg.on("error", () => {
            finish(false);
          });

          const timer = setTimeout(() => {
            ffmpeg.kill();
            finish(false);
          }, 5000);
        });

        return result;
      } catch (error) {
        return false;
      }
    }
  );

  // Process single frame through FFmpeg filter
  ipcMain.handle(
    "processFrame",
    async (
      event: IpcMainInvokeEvent,
      {
        sessionId,
        inputFrameName,
        outputFrameName,
        filterChain,
      }: FrameProcessOptions
    ): Promise<void> => {
      const frameDir: string = tempManager.getFrameDir(sessionId);
      const inputPath: string = path.join(frameDir, inputFrameName);
      const outputPath: string = path.join(frameDir, outputFrameName);

      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input frame not found: ${inputPath}`);
      }

      const ffmpegPath = getFFmpegPath();

      return new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(
          ffmpegPath,
          ["-i", inputPath, "-vf", filterChain, "-y", outputPath],
          {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          }
        );

        let stderr = "";

        ffmpeg.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        ffmpeg.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                `FFmpeg frame processing failed with code ${code}: ${stderr}`
              )
            );
          }
        });

        ffmpeg.on("error", (err) => {
          reject(err);
        });

        setTimeout(() => {
          ffmpeg.kill();
          reject(new Error("Frame processing timeout"));
        }, 10_000);
      });
    }
  );

  // Extract audio from video using FFmpeg CLI
  ipcMain.handle(
    "extract-audio",
    async (
      event: IpcMainInvokeEvent,
      { videoPath, format = "wav" }: ExtractAudioOptions
    ): Promise<ExtractAudioResult> => {
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const ffmpegPath = getFFmpegPath();

      const tempDir = path.join(app.getPath("temp"), "qcut-audio-extraction");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const timestamp = Date.now();
      const outputFileName = `audio-${timestamp}.${format}`;
      const outputPath = path.join(tempDir, outputFileName);

      return new Promise<ExtractAudioResult>((resolve, reject) => {
        // Choose codec and bitrate based on format
        // Use low bitrate for transcription - quality doesn't need to be high
        let codecArgs: string[];
        if (format === "mp3") {
          // MP3: use libmp3lame with low bitrate for speech transcription
          // 32kbps mono at 16kHz is sufficient for speech recognition
          codecArgs = [
            "-acodec",
            "libmp3lame",
            "-ab",
            "32k",
            "-ar",
            "16000",
            "-ac",
            "1",
          ];
        } else if (format === "aac" || format === "m4a") {
          // AAC: low bitrate for speech
          codecArgs = [
            "-acodec",
            "aac",
            "-ab",
            "32k",
            "-ar",
            "16000",
            "-ac",
            "1",
          ];
        } else {
          // WAV/default: uncompressed PCM
          codecArgs = ["-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1"];
        }

        const args = ["-i", videoPath, "-vn", ...codecArgs, "-y", outputPath];

        const ffmpeg = spawn(ffmpegPath, args, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stderr = "";

        ffmpeg.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        ffmpeg.on("close", (code) => {
          if (code === 0) {
            if (!fs.existsSync(outputPath)) {
              reject(new Error("FFmpeg completed but output file not found"));
              return;
            }

            const stats = fs.statSync(outputPath);

            resolve({
              audioPath: outputPath,
              fileSize: stats.size,
            });
          } else {
            reject(
              new Error(
                `FFmpeg audio extraction failed with code ${code}: ${stderr}`
              )
            );
          }
        });

        ffmpeg.on("error", (err) => {
          reject(err);
        });

        setTimeout(() => {
          ffmpeg.kill();
          reject(new Error("Audio extraction timeout (2 minutes)"));
        }, 120_000);
      });
    }
  );

  // Save sticker image for export
  ipcMain.handle(
    "save-sticker-for-export",
    async (
      event: IpcMainInvokeEvent,
      {
        sessionId,
        stickerId,
        imageData,
        format = "png",
      }: {
        sessionId: string;
        stickerId: string;
        imageData: Uint8Array;
        format?: string;
      }
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        const stickerDir = path.join(
          tempManager.getFrameDir(sessionId),
          "stickers"
        );

        if (!fs.existsSync(stickerDir)) {
          await fs.promises.mkdir(stickerDir, { recursive: true });
        }

        const filename = `sticker_${stickerId}.${format}`;
        const stickerPath = path.join(stickerDir, filename);

        const buffer = Buffer.from(imageData);
        await fs.promises.writeFile(stickerPath, buffer);

        console.log(
          `[FFmpeg] Saved sticker ${stickerId} to: ${stickerPath} (${buffer.length} bytes)`
        );

        return {
          success: true,
          path: stickerPath,
        };
      } catch (error: any) {
        console.error(`[FFmpeg] Failed to save sticker ${stickerId}:`, error);
        return {
          success: false,
          error: error.message,
        };
      }
    }
  );
}

/**
 * Constructs FFmpeg command-line arguments for video export.
 *
 * Supports three modes:
 * - Mode 1: Direct copy (fast, lossless concat) for sequential videos
 * - Mode 1.5: Video normalization (handled by normalizeVideo utility)
 * - Mode 2: Direct video with FFmpeg filters for text/stickers/effects
 */
function buildFFmpegArgs(
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
      audioFiles.forEach((audioFile: AudioFile) => {
        if (!fs.existsSync(audioFile.path)) {
          throw new Error(`Audio file not found: ${audioFile.path}`);
        }
        args.push("-i", audioFile.path);
      });

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
        audioFiles.forEach((audioFile: AudioFile) => {
          if (!fs.existsSync(audioFile.path)) {
            throw new Error(`Audio file not found: ${audioFile.path}`);
          }
          args.push("-i", audioFile.path);
        });

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
        audioFiles.forEach((audioFile: AudioFile) => {
          if (!fs.existsSync(audioFile.path)) {
            throw new Error(`Audio file not found: ${audioFile.path}`);
          }
          args.push("-i", audioFile.path);
        });

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

// Re-export getFFmpegPath and getFFprobePath for backward compatibility (used by main.ts)
export { getFFmpegPath, getFFprobePath } from "./ffmpeg/utils";

// CommonJS export for backward compatibility with main.js
module.exports = {
  setupFFmpegIPC,
  initFFmpegHealthCheck,
  getFFmpegPath,
  getFFprobePath,
};

// ES6 export for TypeScript files
export default {
  setupFFmpegIPC,
  initFFmpegHealthCheck,
  getFFmpegPath,
  getFFprobePath,
};
