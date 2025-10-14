import { ipcMain, app, shell, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { TempManager, ExportSession } from "./temp-manager.js";

// Import timeline constants for shared configuration
// Note: Using relative path since this runs in compiled electron context
const timelineConstants = { MAX_EXPORT_DURATION: 600 }; // TODO: Import from shared constants when ES modules are supported

/**
 * Audio file configuration for FFmpeg video export
 * Defines audio track placement and mixing parameters
 */
interface AudioFile {
  /** File system path to the audio file */
  path: string;
  /** Start time in seconds for audio placement in video */
  startTime: number;
  /** Audio volume level (0.0-1.0, optional) */
  volume?: number;
}

/**
 * Video source configuration for direct copy optimization
 * Contains file path and timing information for video elements
 */
interface VideoSource {
  /** File system path to the video file */
  path: string;
  /** Start time in the final timeline (seconds) */
  startTime: number;
  /** Duration to use from this video (seconds) */
  duration: number;
  /** Trim start time within the source video (seconds) */
  trimStart?: number;
  /** Trim end time within the source video (seconds) */
  trimEnd?: number;
}

/**
 * Configuration options for video export operations
 * Contains all parameters needed for FFmpeg video generation
 */
interface ExportOptions {
  /** Unique identifier for the export session */
  sessionId: string;
  /** Output video width in pixels */
  width: number;
  /** Output video height in pixels */
  height: number;
  /** Target frames per second */
  fps: number;
  /** Quality preset affecting encoding parameters */
  quality: "high" | "medium" | "low";
  /** Duration of the video in seconds (replaces hardcoded 10s limit) */
  duration: number;
  /** Optional array of audio files to mix into the video */
  audioFiles?: AudioFile[];
  /** Optional FFmpeg filter chain string for video effects */
  filterChain?: string;
  /** Enable direct video copy/concat optimization (skips frame rendering) */
  useDirectCopy?: boolean;
  /** Video sources for direct copy optimization (when useDirectCopy=true) */
  videoSources?: VideoSource[];
}

/**
 * Individual frame data for video export
 * Contains base64 encoded frame image data
 */
/**
 * Options for processing a single frame through FFmpeg filters
 */
interface FrameProcessOptions {
  /** Export session identifier */
  sessionId: string;
  /** Input frame filename (e.g., "raw_frame-0001.png") */
  inputFrameName: string;
  /** Output frame filename (e.g., "frame-0001.png") */
  outputFrameName: string;
  /** FFmpeg filter chain to apply */
  filterChain: string;
}

interface FrameData {
  /** Export session identifier */
  sessionId: string;
  /** Unique name/identifier for this frame */
  frameName: string;
  /** Base64 encoded image data for the frame */
  data: string;
}

/**
 * Result of a video export operation
 * Contains success status and output file information
 */
interface ExportResult {
  /** Whether the export operation succeeded */
  success: boolean;
  /** Path to the generated output video file */
  outputFile: string;
  /** Export method used (spawn process vs manual) */
  method: "spawn" | "manual";
  /** Optional message with additional details */
  message?: string;
}

/**
 * FFmpeg encoding quality configuration.
 * CRF controls quality (lower=better); preset controls speed.
 */
interface QualitySettings {
  /** Constant Rate Factor: 18 (high), 23 (medium), 28 (low) */
  crf: string;
  /** Encoding speed: slow (best quality), fast, veryfast */
  preset: string;
}

/**
 * Maps quality levels to FFmpeg encoding parameters.
 */
interface QualityMap {
  [key: string]: QualitySettings;
  high: QualitySettings;
  medium: QualitySettings;
  low: QualitySettings;
}

/**
 * FFmpeg export progress data parsed from stderr output.
 * Used for UI progress bar updates during video encoding.
 */
interface FFmpegProgress {
  /** Current frame number being encoded */
  frame?: number | null;
  /** Elapsed time in HH:MM:SS.ss format */
  time?: string | null;
}

/**
 * Enhanced error type for FFmpeg process failures.
 * Includes exit code, signal, and captured stdio for debugging.
 */
interface FFmpegError extends Error {
  /** Process exit code if exited normally */
  code?: number;
  /** Signal name if process was killed (e.g., "SIGTERM") */
  signal?: string;
  /** FFmpeg stderr output containing error details */
  stderr?: string;
  /** FFmpeg stdout output (usually empty) */
  stdout?: string;
}

/**
 * Result from opening frames folder in system file explorer.
 */
interface OpenFolderResult {
  success: boolean;
  path: string;
}

interface ExtractAudioOptions {
  /** Path to the video file */
  videoPath: string;
  /** Output audio format (wav, mp3, etc.) */
  format?: string;
}

interface ExtractAudioResult {
  /** Path to the extracted audio file in temp directory */
  audioPath: string;
  /** Size of the extracted audio file in bytes */
  fileSize: number;
}

interface FFmpegHandlers {
  "ffmpeg-path": () => Promise<string>;
  "create-export-session": () => Promise<ExportSession>;
  "save-frame": (data: FrameData) => Promise<string>;
  "read-output-file": (outputPath: string) => Promise<Buffer>;
  "cleanup-export-session": (sessionId: string) => Promise<void>;
  "open-frames-folder": (sessionId: string) => Promise<OpenFolderResult>;
  "export-video-cli": (options: ExportOptions) => Promise<ExportResult>;
  "validate-filter-chain": (filterChain: string) => Promise<boolean>;
  "processFrame": (options: FrameProcessOptions) => Promise<void>;
  "extract-audio": (
    options: ExtractAudioOptions
  ) => Promise<ExtractAudioResult>;
}

const tempManager = new TempManager();

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

      // Log first few frames for debugging
      if (frameName === "frame-0000.png" || frameName === "frame-0001.png") {
        // Saved frame to disk
      }

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
        useDirectCopy = false,
      } = options;

      // Validate duration to prevent crashes or excessive resource usage
      const validatedDuration = Math.min(
        Math.max(duration || 0.1, 0.1),
        timelineConstants.MAX_EXPORT_DURATION
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

        const args: string[] = buildFFmpegArgs(
          frameDir,
          outputFile,
          width,
          height,
          fps,
          quality,
          validatedDuration,
          audioFiles,
          options.filterChain,
          useDirectCopy,
          options.videoSources
        );

        // Use async IIFE to handle validation properly
        (async () => {
          // Verify input based on processing mode
          if (useDirectCopy) {
            // Validate that video sources were provided
            if (!options.videoSources || options.videoSources.length === 0) {
              const error =
                "Direct copy mode requested but no video sources provided. Frames were not rendered.";
              reject(new Error(error));
              return;
            }

            // Validate each video source file exists
            for (const video of options.videoSources) {
              if (!fs.existsSync(video.path)) {
                const error = `Video source not found: ${video.path}`;
                reject(new Error(error));
                return;
              }
            }

            // Validate codec compatibility for concat (only if multiple videos)
            if (options.videoSources.length > 1) {
              try {
                const probeResults = await Promise.all(
                  options.videoSources.map((video) =>
                    probeVideoFile(video.path)
                  )
                );

                // Compare all videos against the first one
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
                    const error =
                      "Video codec mismatch detected - direct copy requires identical encoding:\n\n" +
                      `Reference: ${path.basename(reference.path)}\n` +
                      `  Codec: ${reference.codec}, Resolution: ${reference.width}x${reference.height}\n` +
                      `  Pixel Format: ${reference.pix_fmt}, FPS: ${reference.fps}\n\n` +
                      `Mismatched: ${path.basename(current.path)}\n` +
                      `  Codec: ${current.codec}, Resolution: ${current.width}x${current.height}\n` +
                      `  Pixel Format: ${current.pix_fmt}, FPS: ${current.fps}\n\n` +
                      "All videos must have identical codec, resolution, pixel format, and frame rate for direct copy mode.";
                    reject(new Error(error));
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
          } else {
            // Frame-based mode: verify frames exist
            if (!fs.existsSync(frameDir)) {
              const error: string = `Frame directory does not exist: ${frameDir}`;
              reject(new Error(error));
              return;
            }

            const frameFiles: string[] = fs
              .readdirSync(frameDir)
              .filter(
                (f: string) => f.startsWith("frame-") && f.endsWith(".png")
              );

            if (frameFiles.length === 0) {
              const error: string = `No frame files found in: ${frameDir}`;
              reject(new Error(error));
              return;
            }
          }

          // Ensure output directory exists
          const outputDirPath: string = path.dirname(outputFile);
          if (!fs.existsSync(outputDirPath)) {
            fs.mkdirSync(outputDirPath, { recursive: true });
          }

          // Test simple command first: create 1-second video from first frame only
          const simpleArgs: string[] = [
            "-y",
            "-f",
            "image2",
            "-i",
            path.join(frameDir, "frame-0000.png"),
            "-c:v",
            "libx264",
            "-t",
            "1",
            "-pix_fmt",
            "yuv420p",
            outputFile,
          ];

          // Attempt to spawn FFmpeg process directly instead of requiring manual run
          const inputPattern: string = path.join(frameDir, "frame-%04d.png");

          // =============================
          // Try to run FFmpeg directly
          // =============================
          try {
            const ffmpegProc: ChildProcess = spawn(ffmpegPath, args, {
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            });

            let stderrOutput = "";
            let stdoutOutput = "";

            ffmpegProc.stdout?.on("data", (chunk: Buffer) => {
              const text: string = chunk.toString();
              stdoutOutput += text;
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

            // If spawn succeeded we exit early and skip manual fallback logic below.
            return;
          } catch (spawnErr: any) {
            // Direct spawn failed, falling back to manual instructions
          }

          const batchFile: string = path.join(
            tempManager.getOutputDir(sessionId),
            "ffmpeg_run.bat"
          );

          // Create batch file content using Windows CMD syntax
          const ffmpegDir: string = path.dirname(ffmpegPath);
          const ffmpegExe: string = path.basename(ffmpegPath);
          const batchContent: string = `@echo off
cd /d "${ffmpegDir}"
echo Starting FFmpeg export...
${ffmpegExe} -y -framerate 30 -i "${inputPattern}" -c:v libx264 -preset fast -crf 23 -t 5 -pix_fmt yuv420p -movflags +faststart "${outputFile}"
echo FFmpeg exit code: %ERRORLEVEL%
exit /b %ERRORLEVEL%`;

          // Creating batch file workaround

          // Write batch file
          fs.writeFileSync(batchFile, batchContent);

          // Since Electron process spawning is restricted on Windows, provide manual export option
          // Windows process spawning restricted, frames ready for manual export

          // Check if user has already created the video manually
          const checkForManualVideo = (): void => {
            if (fs.existsSync(outputFile)) {
              const stats: fs.Stats = fs.statSync(outputFile);
              // Found manually created video
              resolve({
                success: true,
                outputFile,
                method: "manual",
                message:
                  "Video created manually - frames exported successfully!",
              });
            } else {
              // Provide helpful error with manual instructions
              reject(
                new Error(
                  `FFmpeg process spawning restricted by Windows. Please run the command manually:\n\ncd "${path.dirname(ffmpegPath)}" && ${path.basename(ffmpegPath)} -y -framerate 30 -i "${inputPattern}" -c:v libx264 -preset fast -crf 23 -t 5 -pix_fmt yuv420p "${outputFile}"\n\nFrames location: ${frameDir}`
                )
              );
            }
          };

          // Check immediately and also after a short delay
          checkForManualVideo();
          setTimeout(checkForManualVideo, 2000);
        })().catch(reject); // Close async IIFE and catch any unhandled errors
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
            const isValid = code === 0;
            finish(isValid);
          });

          ffmpeg.on("error", (err) => {
            finish(false);
          });

          // Set timeout to avoid hanging
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

      // Verify input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input frame not found: ${inputPath}`);
      }

      const ffmpegPath = getFFmpegPath();

      return new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(
          ffmpegPath,
          [
            "-i",
            inputPath, // Input PNG frame
            "-vf",
            filterChain, // Apply filter chain
            "-y", // Overwrite output
            outputPath, // Output filtered PNG
          ],
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

        // Set timeout to avoid hanging
        setTimeout(() => {
          ffmpeg.kill();
          reject(new Error("Frame processing timeout"));
        }, 10_000); // 10 second timeout per frame
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
      // Verify input file exists
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const ffmpegPath = getFFmpegPath();

      // Create temp directory for audio extraction
      const tempDir = path.join(app.getPath("temp"), "qcut-audio-extraction");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Generate unique output filename
      const timestamp = Date.now();
      const outputFileName = `audio-${timestamp}.${format}`;
      const outputPath = path.join(tempDir, outputFileName);

      return new Promise<ExtractAudioResult>((resolve, reject) => {
        const startTime = Date.now();

        // FFmpeg command to extract audio
        const args = [
          "-i",
          videoPath, // Input video
          "-vn", // No video
          "-acodec",
          "pcm_s16le", // WAV codec (uncompressed)
          "-ar",
          "16000", // Sample rate 16kHz (optimal for Gemini)
          "-ac",
          "1", // Mono audio
          "-y", // Overwrite output
          outputPath,
        ];

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
            // Verify output file exists and get size
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

        // Set timeout to avoid hanging (2 minutes for large files)
        setTimeout(() => {
          ffmpeg.kill();
          reject(new Error("Audio extraction timeout (2 minutes)"));
        }, 120_000);
      });
    }
  );
}

/**
 * Video stream properties extracted from ffprobe
 */
interface VideoProbeResult {
  path: string;
  codec: string;
  width: number;
  height: number;
  pix_fmt: string;
  fps: string;
}

/**
 * Probes a video file to extract codec information using ffprobe.
 * Used for validating codec compatibility in direct-copy mode.
 *
 * @param videoPath - Absolute path to video file
 * @returns Promise resolving to video stream properties
 * @throws Error if ffprobe fails or video stream not found
 */
async function probeVideoFile(videoPath: string): Promise<VideoProbeResult> {
  // Get ffprobe path (same directory as ffmpeg)
  const ffmpegPath = getFFmpegPath();
  const ffprobeDir = path.dirname(ffmpegPath);
  const ffprobeExe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const ffprobePath = path.join(ffprobeDir, ffprobeExe);

  return new Promise<VideoProbeResult>((resolve, reject) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      videoPath,
    ];

    const ffprobe = spawn(ffprobePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    ffprobe.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const probeData = JSON.parse(stdout);
        const videoStream = probeData.streams?.find(
          (s: any) => s.codec_type === "video"
        );

        if (!videoStream) {
          reject(new Error(`No video stream found in: ${videoPath}`));
          return;
        }

        resolve({
          path: videoPath,
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          pix_fmt: videoStream.pix_fmt,
          fps: videoStream.r_frame_rate,
        });
      } catch (parseErr: any) {
        reject(
          new Error(`Failed to parse ffprobe output: ${parseErr.message}`)
        );
      }
    });

    ffprobe.on("error", (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      ffprobe.kill();
      reject(new Error(`ffprobe timeout for: ${videoPath}`));
    }, 10_000);
  });
}

/**
 * Resolves FFmpeg binary path for current environment (dev/packaged).
 *
 * Packaged apps expect FFmpeg in resources folder; dev mode searches
 * bundled resources then system PATH. Throws if FFmpeg not found.
 *
 * @returns Absolute path to FFmpeg binary or "ffmpeg" for system PATH
 * @throws Error if FFmpeg not found in expected locations
 */
export function getFFmpegPath(): string {
  let ffmpegPath: string;

  if (app.isPackaged) {
    // Production: FFmpeg is in the app's resources folder
    // Path structure: resources/app/electron/resources/ffmpeg.exe
    const appResourcePath: string = path.join(
      process.resourcesPath,
      "app",
      "electron",
      "resources",
      "ffmpeg.exe"
    );

    if (fs.existsSync(appResourcePath)) {
      ffmpegPath = appResourcePath;
    } else {
      // Fallback: try old location for backwards compatibility
      const oldPath: string = path.join(process.resourcesPath, "ffmpeg.exe");
      if (fs.existsSync(oldPath)) {
        ffmpegPath = oldPath;
      } else {
        throw new Error(
          `FFmpeg not found. Searched:\n1. ${appResourcePath}\n2. ${oldPath}`
        );
      }
    }
  } else {
    // Development: try bundled FFmpeg first, then system PATH
    const devPath: string = path.join(__dirname, "resources", "ffmpeg.exe");
    if (fs.existsSync(devPath)) {
      ffmpegPath = devPath;
    } else {
      ffmpegPath = "ffmpeg"; // System PATH
    }
  }

  // Verify FFmpeg exists (skip verification for system PATH)
  if (ffmpegPath !== "ffmpeg" && !fs.existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg not found at: ${ffmpegPath}`);
  }

  // FFmpeg path resolved
  return ffmpegPath;
}

/**
 * Constructs FFmpeg command-line arguments for video export.
 *
 * Supports two modes: direct copy (fast, lossless concat) and image pipeline
 * (slow, frame-by-frame encoding). Direct copy requires sequential videos
 * with no overlays/effects; falls back to image pipeline otherwise.
 *
 * @param inputDir - Directory containing frame images or concat file
 * @param outputFile - Path where output video will be saved
 * @param width - Output video width in pixels
 * @param height - Output video height in pixels
 * @param fps - Target frames per second
 * @param quality - Encoding quality preset (affects CRF and preset)
 * @param duration - Video duration in seconds
 * @param audioFiles - Audio tracks to mix into video
 * @param filterChain - Optional FFmpeg filter string for effects
 * @param useDirectCopy - Enable fast direct copy mode if possible
 * @param videoSources - Video file paths for direct copy mode
 * @returns Array of FFmpeg command-line arguments
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
  useDirectCopy = false,
  videoSources?: VideoSource[]
): string[] {
  const qualitySettings: QualityMap = {
    "high": { crf: "18", preset: "slow" },
    "medium": { crf: "23", preset: "fast" },
    "low": { crf: "28", preset: "veryfast" },
  };

  const { crf, preset }: QualitySettings =
    qualitySettings[quality] || qualitySettings.medium;

  // Handle direct copy mode
  if (useDirectCopy && videoSources && videoSources.length > 0) {
    const args: string[] = ["-y"]; // Overwrite output

    // Single video: use direct copy with trim
    if (videoSources.length === 1) {
      const video = videoSources[0];

      // Validate video file exists
      if (!fs.existsSync(video.path)) {
        throw new Error(`Video source not found: ${video.path}`);
      }

      // Calculate effective duration (subtract trim values)
      const effectiveDuration =
        video.duration - (video.trimStart || 0) - (video.trimEnd || 0);

      // Apply trim start (seek to position)
      if (video.trimStart && video.trimStart > 0) {
        args.push("-ss", video.trimStart.toString());
      }

      args.push("-i", video.path);

      // Set effective duration (subtract trim values)
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

        // Build audio mixing filter
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
          // Multiple audio files
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

      // Use direct stream copy for video
      args.push("-c:v", "copy");
    } else {
      // Multiple videos: use concat demuxer
      // Create concat file content
      const concatFileContent = videoSources
        .map((video) => {
          // Validate each video file exists
          if (!fs.existsSync(video.path)) {
            throw new Error(`Video source not found: ${video.path}`);
          }

          // Concat demuxer doesn't support per-source trims
          if (
            (video.trimStart && video.trimStart > 0) ||
            (video.trimEnd && video.trimEnd > 0)
          ) {
            throw new Error(
              `Video '${path.basename(video.path)}' has trim values (trimStart=${video.trimStart || 0}s, trimEnd=${video.trimEnd || 0}s). ` +
                `The concat demuxer doesn't support per-video trimming in multi-video mode. ` +
                "Please disable direct copy mode or pre-trim videos before export."
            );
          }

          // Escape single quotes in file path for concat file format
          const escapedPath = video.path.replace(/'/g, "'\\''");
          return `file '${escapedPath}'`;
        })
        .join("\n");

      // Write concat file to temp directory
      const concatFilePath = path.join(inputDir, "concat-list.txt");
      fs.writeFileSync(concatFilePath, concatFileContent);

      // Use concat demuxer
      args.push("-f", "concat", "-safe", "0", "-i", concatFilePath);

      // Add audio inputs if provided
      if (audioFiles && audioFiles.length > 0) {
        audioFiles.forEach((audioFile: AudioFile) => {
          if (!fs.existsSync(audioFile.path)) {
            throw new Error(`Audio file not found: ${audioFile.path}`);
          }
          args.push("-i", audioFile.path);
        });

        // Build audio mixing filter
        const audioInputOffset = 1; // Concat is input 0, audio starts at 1
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

      // Use direct stream copy for video
      args.push("-c:v", "copy");
    }

    // Add common output settings
    args.push("-movflags", "+faststart", outputFile);

    return args;
  }

  // If we reach here with useDirectCopy=true, something is wrong
  if (useDirectCopy) {
    throw new Error(
      "Direct copy requested but no video sources available. " +
        "This indicates a configuration error - frames were not rendered and video sources are unavailable."
    );
  }

  // Frame-based processing (normal path)
  const inputPattern: string = path.join(inputDir, "frame-%04d.png");

  const args: string[] = [
    "-y", // Overwrite output
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
  ];

  // Add filter chain if provided
  if (filterChain && filterChain.trim()) {
    args.push("-vf", filterChain);
  }

  // Add audio inputs if provided
  if (audioFiles && audioFiles.length > 0) {
    // Add each audio file as input
    audioFiles.forEach((audioFile: AudioFile, index: number) => {
      // CRITICAL: Check if audio file actually exists
      if (!fs.existsSync(audioFile.path)) {
        throw new Error(`Audio file not found: ${audioFile.path}`);
      }

      args.push("-i", audioFile.path);
    });

    // Build complex filter for audio mixing with timing
    if (audioFiles.length === 1) {
      // Single audio file - apply delay if needed
      const audioFile: AudioFile = audioFiles[0];
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
        // No delay needed
        args.push("-map", "0:v", "-map", "1:a");
      }
    } else {
      // Multiple audio files - mix them together
      const filterParts: string[] = [];
      const inputMaps: string[] = [];

      audioFiles.forEach((audioFile: AudioFile, index: number) => {
        const inputIndex: number = index + 1; // +1 because video is input 0
        let audioFilter = `[${inputIndex}:a]`;

        // Apply volume if specified
        if (audioFile.volume !== undefined && audioFile.volume !== 1.0) {
          audioFilter += `volume=${audioFile.volume}[a${index}]`;
          inputMaps.push(`[a${index}]`);
        } else {
          inputMaps.push(audioFilter);
        }

        // Apply delay if needed
        if (audioFile.startTime > 0) {
          const delayMs: number = Math.round(audioFile.startTime * 1000);
          if (audioFile.volume !== undefined && audioFile.volume !== 1.0) {
            audioFilter += `; [a${index}]adelay=${delayMs}|${delayMs}[ad${index}]`;
            inputMaps[inputMaps.length - 1] = `[ad${index}]`;
          } else {
            audioFilter += `adelay=${delayMs}|${delayMs}[ad${index}]`;
            inputMaps[inputMaps.length - 1] = `[ad${index}]`;
          }
        }

        if (audioFilter !== `[${inputIndex}:a]`) {
          filterParts.push(audioFilter);
        }
      });

      // Mix all audio inputs
      const mixFilter: string = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;

      const fullFilter: string =
        filterParts.length > 0
          ? `${filterParts.join("; ")}; ${mixFilter}`
          : mixFilter;

      args.push(
        "-filter_complex",
        fullFilter,
        "-map",
        "0:v",
        "-map",
        "[audio]"
      );
    }

    // Audio codec settings
    args.push("-c:a", "aac", "-b:a", "128k");
  }

  // Video codec settings
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-t",
    duration.toString(), // Duration already validated at entry point
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputFile
  );

  return args;
}

/**
 * Extracts progress information from FFmpeg stderr output.
 *
 * FFmpeg writes progress to stderr (not stdout); this parser extracts
 * frame numbers and timestamps for UI progress updates.
 *
 * @param output - Raw stderr text from FFmpeg process
 * @returns Parsed frame/time data, or null if no progress info found
 */
function parseProgress(output: string): FFmpegProgress | null {
  // Parse FFmpeg progress from output
  const frameMatch: RegExpMatchArray | null = output.match(/frame=\s*(\d+)/);
  const timeMatch: RegExpMatchArray | null = output.match(
    /time=(\d+:\d+:\d+\.\d+)/
  );

  if (frameMatch || timeMatch) {
    return {
      frame: frameMatch ? parseInt(frameMatch[1]) : null,
      time: timeMatch ? timeMatch[1] : null,
    };
  }
  return null;
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupFFmpegIPC, getFFmpegPath };

// ES6 export for TypeScript files
export default { setupFFmpegIPC, getFFmpegPath };
export type {
  AudioFile,
  ExportOptions,
  FrameData,
  ExportResult,
  FFmpegProgress,
  FFmpegHandlers,
  OpenFolderResult,
  ExtractAudioOptions,
  ExtractAudioResult,
};
