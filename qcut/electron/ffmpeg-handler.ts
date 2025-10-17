import { ipcMain, app, shell, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { TempManager, ExportSession } from "./temp-manager.js";

// Import timeline constants for shared configuration
// Note: Using relative path since this runs in compiled electron context
const timelineConstants = { MAX_EXPORT_DURATION: 600 }; // TODO: Import from shared constants when ES modules are supported

// Debug logging for development
const debugLog = (...args: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[FFmpeg]', ...args);
  }
};

const debugWarn = (...args: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[FFmpeg]', ...args);
  }
};

const debugError = (...args: any[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[FFmpeg]', ...args);
  }
};

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
 * Sticker source configuration for FFmpeg overlay
 * Contains file path and positioning information for stickers
 */
interface StickerSource {
  /** Unique identifier for the sticker */
  id: string;
  /** File system path to the sticker image */
  path: string;
  /** X position in pixels (top-left corner) */
  x: number;
  /** Y position in pixels (top-left corner) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Start time in seconds for sticker appearance */
  startTime: number;
  /** End time in seconds for sticker disappearance */
  endTime: number;
  /** Layer order (higher = on top) */
  zIndex: number;
  /** Opacity (0-1, optional) */
  opacity?: number;
  /** Rotation in degrees (optional) */
  rotation?: number;
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
  /** Optional FFmpeg drawtext filter chain for text overlays */
  textFilterChain?: string;
  /** Optional FFmpeg overlay filter chain for stickers */
  stickerFilterChain?: string;
  /** Sticker image sources for overlay (when stickerFilterChain is provided) */
  stickerSources?: StickerSource[];
  /** Enable direct video copy/concat optimization (skips frame rendering) */
  useDirectCopy?: boolean;
  /** Video sources for direct copy optimization (when useDirectCopy=true) */
  videoSources?: VideoSource[];
  /** Use video file instead of frames (Mode 2 optimization) */
  useVideoInput?: boolean;
  /** Direct video file path for Mode 2 */
  videoInputPath?: string;
  /** Video trim start time in seconds */
  trimStart?: number;
  /** Video trim end time in seconds */
  trimEnd?: number;
  /** Optimization strategy for export mode selection (Mode 1, 1.5, 2, or 3) */
  optimizationStrategy?: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters' | 'video-normalization';
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
        textFilterChain,
        stickerFilterChain,
        stickerSources,
        useDirectCopy = false,
      } = options;

      // Validate sticker configuration
      if (stickerFilterChain && (!stickerSources || stickerSources.length === 0)) {
        throw new Error("Sticker filter chain provided without sticker sources");
      }

      // Disable direct copy when stickers are present
      const effectiveUseDirectCopy = useDirectCopy &&
        !textFilterChain &&
        !stickerFilterChain &&
        !options.filterChain;

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

        // Use async IIFE to handle validation properly
        (async () => {
          // =============================================================================
          // MODE 1.5: Video Normalization with FFmpeg Padding
          // =============================================================================
          if (options.optimizationStrategy === 'video-normalization') {
            console.log('⚡ [MODE 1.5 EXPORT] ============================================');
            console.log('⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding');
            console.log(`⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`);
            console.log(`⚡ [MODE 1.5 EXPORT] Target resolution: ${width}x${height}`);
            console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${fps}`);
            console.log('⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3');
            console.log('⚡ [MODE 1.5 EXPORT] ============================================');

            try {
              // Validate video sources exist
              if (!options.videoSources || options.videoSources.length === 0) {
                const error = 'Mode 1.5 requires video sources but none provided';
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

              console.log(`⚡ [MODE 1.5 EXPORT] ✅ All ${options.videoSources.length} video sources validated`);

              // Step 1: Normalize all videos to target resolution and fps
              console.log(`⚡ [MODE 1.5 EXPORT] Step 1/3: Normalizing ${options.videoSources.length} videos...`);
              const normalizedPaths: string[] = [];

              for (let i = 0; i < options.videoSources.length; i++) {
                const source = options.videoSources[i];
                const normalizedPath = path.join(frameDir, `normalized_video_${i}.mp4`);

                console.log(`⚡ [MODE 1.5 EXPORT] Normalizing video ${i + 1}/${options.videoSources.length}...`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Source: ${path.basename(source.path)}`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Duration: ${source.duration}s`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Trim: start=${source.trimStart || 0}s, end=${source.trimEnd || 0}s`);

                // Call normalizeVideo function (defined earlier in this file)
                await normalizeVideo(
                  source.path,
                  normalizedPath,
                  width,
                  height,
                  fps,
                  source.trimStart || 0,
                  source.trimEnd || 0
                );

                normalizedPaths.push(normalizedPath);
                console.log(`⚡ [MODE 1.5 EXPORT] ✅ Video ${i + 1}/${options.videoSources.length} normalized`);
              }

              console.log(`⚡ [MODE 1.5 EXPORT] All videos normalized successfully`);

              // Step 2/3: Create concat list file for FFmpeg concat demuxer
              console.log(`⚡ [MODE 1.5 EXPORT] Step 2/3: Creating concat list...`);
              const concatListPath = path.join(frameDir, 'concat-list.txt');

              // Escape Windows backslashes for FFmpeg concat file format
              // FFmpeg requires forward slashes in file paths
              const concatContent = normalizedPaths
                .map(p => {
                  // Escape single quotes in path (FFmpeg concat file format)
                  const escapedPath = p.replace(/'/g, "'\\''").replace(/\\/g, '/');
                  return `file '${escapedPath}'`;
                })
                .join('\n');

              fs.writeFileSync(concatListPath, concatContent, 'utf-8');
              console.log(`⚡ [MODE 1.5 EXPORT] ✅ Concat list created: ${normalizedPaths.length} videos`);
              console.log(`⚡ [MODE 1.5 EXPORT] Concat list path: ${concatListPath}`);

              // Step 3/3: Concatenate normalized videos using FFmpeg concat demuxer (fast!)
              console.log(`⚡ [MODE 1.5 EXPORT] Step 3/3: Concatenating ${normalizedPaths.length} normalized videos...`);
              console.log(`⚡ [MODE 1.5 EXPORT] Using concat demuxer (no re-encoding = fast!)`);

              // Build concat command arguments
              const concatArgs: string[] = [
                '-y',               // Overwrite output
                '-f', 'concat',     // Use concat demuxer
                '-safe', '0',       // Allow absolute paths
                '-i', concatListPath, // Input concat list file
                '-c', 'copy',       // Direct copy - no re-encoding!
                '-movflags', '+faststart', // Optimize for streaming
                outputFile
              ];

              console.log(`⚡ [MODE 1.5 EXPORT] FFmpeg concat command: ffmpeg ${concatArgs.join(' ')}`);

              // Execute concat with progress monitoring
              await new Promise<void>((concatResolve, concatReject) => {
                const concatProcess: ChildProcess = spawn(ffmpegPath, concatArgs, {
                  windowsHide: true,
                  stdio: ['ignore', 'pipe', 'pipe']
                });

                let concatStderr = '';
                let concatStdout = '';

                // Capture stdout
                concatProcess.stdout?.on('data', (chunk: Buffer) => {
                  concatStdout += chunk.toString();
                });

                // Capture stderr and monitor progress
                concatProcess.stderr?.on('data', (chunk: Buffer) => {
                  const text = chunk.toString();
                  concatStderr += text;

                  // Parse progress for progress events
                  const progress: FFmpegProgress | null = parseProgress(text);
                  if (progress) {
                    event.sender?.send?.('ffmpeg-progress', progress);
                  }
                });

                // Handle process completion
                concatProcess.on('close', (code: number | null) => {
                  if (code === 0) {
                    // Verify output file exists
                    if (fs.existsSync(outputFile)) {
                      const stats = fs.statSync(outputFile);
                      console.log(`⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!`);
                      console.log(`⚡ [MODE 1.5 EXPORT] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                      concatResolve();
                    } else {
                      const error = `Output file not created: ${outputFile}`;
                      console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
                      concatReject(new Error(error));
                    }
                  } else {
                    console.error(`❌ [MODE 1.5 EXPORT] Concatenation failed with code ${code}`);
                    console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${concatStderr}`);
                    concatReject(new Error(`FFmpeg concat failed with code ${code}`));
                  }
                });

                // Handle process errors
                concatProcess.on('error', (err: Error) => {
                  console.error(`❌ [MODE 1.5 EXPORT] FFmpeg process error:`, err);
                  concatReject(err);
                });
              });

              // TODO: Audio mixing not yet implemented for Mode 1.5
              if (audioFiles && audioFiles.length > 0) {
                console.warn('⚠️ [MODE 1.5 EXPORT] Audio mixing not yet implemented for Mode 1.5');
                console.warn('⚠️ [MODE 1.5 EXPORT] Falling back to Mode 3 for audio support');
                throw new Error('Audio mixing not supported in Mode 1.5 - falling back to Mode 3');
              }

              // Success! Export complete
              console.log('⚡ [MODE 1.5 EXPORT] ============================================');
              console.log('⚡ [MODE 1.5 EXPORT] ✅ Export complete!');
              console.log(`⚡ [MODE 1.5 EXPORT] Output: ${outputFile}`);
              console.log(`⚡ [MODE 1.5 EXPORT] Mode: video-normalization (5-7x faster than Mode 3)`);
              console.log('⚡ [MODE 1.5 EXPORT] ============================================');

              // Return success result
              resolve({
                success: true,
                outputFile: outputFile,
                method: 'spawn'
              });

              return; // Exit early - don't continue to other mode validations

            } catch (error: any) {
              // Mode 1.5 failed - fall back to Mode 3 (frame rendering)
              console.error('❌ [MODE 1.5 EXPORT] ============================================');
              console.error('❌ [MODE 1.5 EXPORT] Normalization failed, falling back to Mode 3');
              console.error('❌ [MODE 1.5 EXPORT] Error:', error.message || error);
              console.error('❌ [MODE 1.5 EXPORT] ============================================');

              // Don't reject - fall through to Mode 3 validation below
              // This ensures exports don't fail if normalization has issues
            }
          }

          // Continue with existing mode validations (Mode 1, 2, 3) below...
          // Verify input based on processing mode
          if (effectiveUseDirectCopy) {
            // MODE 1: Direct copy - validate video sources
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
          } else if (options.useVideoInput && options.videoInputPath) {
            // MODE 2: Direct video input with filters - validate video file exists
            console.log('⚡ [MODE 2 VALIDATION] Validating video input file...');
            console.log(`⚡ [MODE 2 VALIDATION] Video path: ${options.videoInputPath}`);

            if (!fs.existsSync(options.videoInputPath)) {
              const error = `Mode 2 video input not found: ${options.videoInputPath}`;
              console.error(`❌ [MODE 2 VALIDATION] ${error}`);
              reject(new Error(error));
              return;
            }

            console.log('⚡ [MODE 2 VALIDATION] ✅ Video file validated successfully');
            console.log('⚡ [MODE 2 VALIDATION] Frame rendering: SKIPPED (using direct video input)');
          } else {
            // MODE 3: Frame-based mode - verify frames exist
            console.log('🎨 [MODE 3 VALIDATION] Validating frame files...');

            if (!fs.existsSync(frameDir)) {
              const error: string = `Frame directory does not exist: ${frameDir}`;
              console.error(`❌ [MODE 3 VALIDATION] ${error}`);
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
              console.error(`❌ [MODE 3 VALIDATION] ${error}`);
              reject(new Error(error));
              return;
            }

            console.log(`🎨 [MODE 3 VALIDATION] ✅ Found ${frameFiles.length} frame files`);
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
        imageData: ArrayBuffer;
        format?: string;
      }
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        const stickerDir = path.join(
          tempManager.getFrameDir(sessionId),
          "stickers"
        );

        // Create stickers directory if it doesn't exist
        if (!fs.existsSync(stickerDir)) {
          await fs.promises.mkdir(stickerDir, { recursive: true });
        }

        const filename = `sticker_${stickerId}.${format}`;
        const stickerPath = path.join(stickerDir, filename);

        // Write image data to file asynchronously
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
 * Normalize a single video to target resolution and fps using FFmpeg padding.
 *
 * WHY Mode 1.5 normalization is needed:
 * - FFmpeg concat demuxer requires identical video properties (codec, resolution, fps)
 * - Videos from different sources often have mismatched properties
 * - Frame rendering (Mode 3) is 5-7x slower than normalization
 * - Normalization preserves quality while enabling fast concat
 *
 * FFmpeg filter chain breakdown:
 * - `scale`: Resize video to fit target dimensions (maintains aspect ratio)
 * - `force_original_aspect_ratio=decrease`: Prevents upscaling, only downscales
 * - `pad`: Adds black bars to reach exact target dimensions
 * - `(ow-iw)/2`: Centers horizontally (output_width - input_width) / 2
 * - `(oh-ih)/2`: Centers vertically (output_height - input_height) / 2
 * - `:black`: Black padding color
 *
 * Edge cases handled:
 * - Trim timing: `-ss` before input (fast seeking), `-t` for duration
 * - Audio sync: `-async 1` prevents desync during fps conversion
 * - Overwrite: `-y` flag for automated workflows
 * - Progress monitoring: Parses FFmpeg stderr for frame progress
 *
 * Performance characteristics:
 * - ~0.5-1s per video with ultrafast preset
 * - CRF 18 = visually lossless quality
 * - Audio copy = no audio re-encoding overhead
 *
 * @param inputPath - Absolute path to source video file
 * @param outputPath - Absolute path for normalized output (in temp directory)
 * @param targetWidth - Target width in pixels (from export settings)
 * @param targetHeight - Target height in pixels (from export settings)
 * @param targetFps - Target frame rate (from export settings)
 * @param trimStart - Trim start time in seconds (0 = no trim)
 * @param trimEnd - Trim end time in seconds (0 = no trim)
 * @returns Promise that resolves when normalization completes
 * @throws Error if FFmpeg process fails or file not found
 */
async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  trimStart: number = 0,
  trimEnd: number = 0
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log('⚡ [MODE 1.5 NORMALIZE] ============================================');
    console.log('⚡ [MODE 1.5 NORMALIZE] Starting video normalization...');
    console.log(`⚡ [MODE 1.5 NORMALIZE] Input: ${path.basename(inputPath)}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Output: ${path.basename(outputPath)}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Trim: start=${trimStart}s, end=${trimEnd}s`);

    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      const error = `Video source not found: ${inputPath}`;
      console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
      reject(new Error(error));
      return;
    }

    // Build FFmpeg filter chain for padding
    // force_original_aspect_ratio=decrease: Only scale down, never upscale
    // pad: Add black bars to reach exact target dimensions, centered
    const filterChain = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;
    console.log(`⚡ [MODE 1.5 NORMALIZE] Filter chain: ${filterChain}`);

    const args: string[] = ['-y']; // Overwrite output

    // Apply trim start (seek to position) BEFORE input for faster seeking
    // WHY before input: Input seeking is much faster than output seeking
    if (trimStart && trimStart > 0) {
      args.push('-ss', trimStart.toString());
      console.log(`⚡ [MODE 1.5 NORMALIZE] Applying input seek: -ss ${trimStart}s`);
    }

    // Input file
    args.push('-i', inputPath);

    // Set duration (if trim specified)
    // Note: trimEnd is absolute time, need to calculate duration
    if (trimEnd && trimEnd > trimStart) {
      const duration = trimEnd - trimStart;
      args.push('-t', duration.toString());
      console.log(`⚡ [MODE 1.5 NORMALIZE] Setting duration: -t ${duration}s`);
    }

    // Video filters (scale + pad)
    args.push('-vf', filterChain);

    // Frame rate conversion
    args.push('-r', targetFps.toString());

    // Video encoding settings (matching Mode 2 patterns)
    args.push(
      '-c:v', 'libx264',       // H.264 codec (universal compatibility)
      '-preset', 'ultrafast',  // Fast encoding (prioritize speed over compression)
      '-crf', '18',            // High quality (18 = visually lossless)
      '-pix_fmt', 'yuv420p'    // Pixel format (ensures compatibility)
    );

    // Audio settings (copy without re-encoding for speed)
    args.push('-c:a', 'copy');

    // Audio sync (critical for fps conversion)
    // WHY: FPS changes can cause audio drift, -async 1 resamples to maintain sync
    args.push('-async', '1');

    // Output file
    args.push(outputPath);

    console.log(`⚡ [MODE 1.5 NORMALIZE] FFmpeg command: ffmpeg ${args.join(' ')}`);
    console.log('⚡ [MODE 1.5 NORMALIZE] Starting FFmpeg process...');

    // Get FFmpeg path
    const ffmpegPath = getFFmpegPath();

    // Spawn FFmpeg process (matching existing patterns in buildFFmpegArgs)
    const ffmpegProcess = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrOutput = '';
    let stdoutOutput = '';

    // Capture stdout (usually empty)
    ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutOutput += chunk.toString();
    });

    // Capture stderr for progress and errors
    ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;

      // Log progress (FFmpeg outputs progress to stderr)
      // Extract frame count for progress monitoring
      if (text.includes('frame=')) {
        const frameMatch = text.match(/frame=\s*(\d+)/);
        const timeMatch = text.match(/time=(\d+:\d+:\d+\.\d+)/);
        if (frameMatch || timeMatch) {
          const frame = frameMatch ? frameMatch[1] : '?';
          const time = timeMatch ? timeMatch[1] : '?';
          process.stdout.write(`⚡ [MODE 1.5 NORMALIZE] Progress: frame=${frame} time=${time}\r`);
        }
      }
    });

    // Handle process completion
    ffmpegProcess.on('close', (code: number | null) => {
      process.stdout.write('\n'); // Clear progress line

      if (code === 0) {
        // Verify output file was created
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`⚡ [MODE 1.5 NORMALIZE] ✅ Normalization complete: ${path.basename(outputPath)}`);
          console.log(`⚡ [MODE 1.5 NORMALIZE] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          console.log('⚡ [MODE 1.5 NORMALIZE] ============================================');
          resolve();
        } else {
          const error = `Output file not created: ${outputPath}`;
          console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
          reject(new Error(error));
        }
      } else {
        console.error(`❌ [MODE 1.5 NORMALIZE] Normalization failed with code ${code}`);
        console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg stderr:\n${stderrOutput}`);
        console.error('❌ [MODE 1.5 NORMALIZE] ============================================');
        reject(new Error(`FFmpeg normalization failed with code ${code}`));
      }
    });

    // Handle process errors
    ffmpegProcess.on('error', (error: Error) => {
      console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg process error:`, error);
      console.error('❌ [MODE 1.5 NORMALIZE] ============================================');
      reject(error);
    });
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
  const qualitySettings: QualityMap = {
    "high": { crf: "18", preset: "slow" },
    "medium": { crf: "23", preset: "fast" },
    "low": { crf: "28", preset: "veryfast" },
  };

  const { crf, preset }: QualitySettings =
    qualitySettings[quality] || qualitySettings.medium;

  // =============================================================================
  // MODE 2: Direct video input with FFmpeg filters (text/stickers)
  // =============================================================================
  if (useVideoInput && videoInputPath) {
    console.log('⚡ [MODE 2] ============================================');
    console.log('⚡ [MODE 2] Entering Mode 2: Direct video input with filters');
    console.log(`⚡ [MODE 2] Video input path: ${videoInputPath}`);
    console.log(`⚡ [MODE 2] Trim settings: start=${trimStart || 0}s, end=${trimEnd || 0}s`);
    console.log(`⚡ [MODE 2] Duration: ${duration}s`);
    debugLog('[FFmpeg] MODE 2: Using direct video input with filters');
    const args: string[] = ["-y"]; // Overwrite output

    // Validate video file exists
    if (!fs.existsSync(videoInputPath)) {
      throw new Error(`Video source not found: ${videoInputPath}`);
    }
    console.log('⚡ [MODE 2] ✅ Video file validated successfully');

    // Apply trim start (seek to position) BEFORE input for faster seeking
    if (trimStart && trimStart > 0) {
      args.push("-ss", trimStart.toString());
    }

    // Video input
    args.push("-i", videoInputPath);

    // Set duration (duration parameter already reflects trimmed timeline)
    if (duration) {
      args.push("-t", duration.toString());
    }

    // Add sticker image inputs (after video input)
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

    // Apply video effects first (if any)
    if (filterChain) {
      filters.push(filterChain);
      console.log(`⚡ [MODE 2] Video effects filter: ${filterChain.substring(0, 100)}...`);
    }

    // Apply sticker overlays (middle layer)
    if (stickerFilterChain) {
      filters.push(stickerFilterChain);
      console.log(`⚡ [MODE 2] Sticker filter chain: ${stickerFilterChain.substring(0, 100)}...`);
    }

    // Apply text overlays (on top of everything)
    if (textFilterChain) {
      filters.push(textFilterChain);
      console.log(`⚡ [MODE 2] Text filter chain: ${textFilterChain.substring(0, 100)}...`);
    }

    // Log filter summary
    console.log(`⚡ [MODE 2] Total filters: ${filters.length}`);
    console.log(`⚡ [MODE 2] Filters: ${filters.length > 0 ? filters.map((f, i) => `[${i}] ${f.substring(0, 50)}`).join(', ') : 'none'}`);

    // Apply combined filters if any exist
    if (filters.length > 0) {
      if (stickerSources && stickerSources.length > 0) {
        // Complex filter with multiple inputs
        args.push("-filter_complex", filters.join(';'));
        console.log('⚡ [MODE 2] Using -filter_complex (multiple inputs)');
      } else {
        // Simple filters can use -vf
        args.push("-vf", filters.join(','));
        console.log('⚡ [MODE 2] Using -vf (single input)');
      }
    } else {
      console.log('⚡ [MODE 2] No filters applied');
    }

    // Add audio inputs and mixing (if provided)
    const stickerCount = stickerSources?.length || 0;
    if (audioFiles && audioFiles.length > 0) {
      audioFiles.forEach((audioFile: AudioFile) => {
        if (!fs.existsSync(audioFile.path)) {
          throw new Error(`Audio file not found: ${audioFile.path}`);
        }
        args.push("-i", audioFile.path);
      });

      // Audio mixing logic (same as frame mode but adjust input indices)
      if (audioFiles.length === 1) {
        const audioFile = audioFiles[0];
        const audioInputIndex = 1 + stickerCount; // Account for stickers
        if (audioFile.startTime > 0) {
          args.push(
            "-filter_complex",
            `[${audioInputIndex}:a]adelay=${Math.round(audioFile.startTime * 1000)}|${Math.round(audioFile.startTime * 1000)}[audio]`,
            "-map", "0:v",
            "-map", "[audio]"
          );
        } else {
          args.push("-map", "0:v", "-map", `${audioInputIndex}:a`);
        }
      } else {
        // Multiple audio files mixing
        const inputMaps: string[] = audioFiles.map((_, i) => `[${i + 1 + stickerCount}:a]`);
        const mixFilter = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;
        args.push("-filter_complex", mixFilter, "-map", "0:v", "-map", "[audio]");
      }
      args.push("-c:a", "aac", "-b:a", "128k");
    }

    // Video codec settings
    args.push("-c:v", "libx264");
    args.push("-preset", preset);
    args.push("-crf", crf);
    args.push("-pix_fmt", "yuv420p");
    args.push("-movflags", "+faststart");
    args.push(outputFile);

    console.log('⚡ [MODE 2] ✅ FFmpeg args built successfully');
    console.log(`⚡ [MODE 2] Codec settings: libx264, preset=${preset}, crf=${crf}`);
    console.log(`⚡ [MODE 2] Audio files: ${audioFiles?.length || 0}`);
    console.log(`⚡ [MODE 2] Sticker inputs: ${stickerCount}`);
    console.log(`⚡ [MODE 2] Total args count: ${args.length}`);
    console.log('⚡ [MODE 2] ============================================');
    debugLog('[FFmpeg] MODE 2 args built successfully');
    return args;
  }
  // =============================================================================
  // END MODE 2
  // =============================================================================

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

  // Add sticker image inputs
  const stickerCount = stickerSources?.length || 0;
  if (stickerSources && stickerSources.length > 0) {
    // Validate each sticker file exists
    for (const sticker of stickerSources) {
      if (!fs.existsSync(sticker.path)) {
        console.warn(`[FFmpeg] Sticker file not found: ${sticker.path}`);
        continue;
      }
      // Add as input (will be indexed as [1], [2], etc. after base video [0])
      args.push("-loop", "1");  // Loop single image
      args.push("-i", sticker.path);
    }
  }

  // Combine filter chains if provided (video effects, stickers, then text)
  const combinedFilters: string[] = [];

  // Step 1: Video effects (brightness, contrast, etc.)
  if (filterChain && filterChain.trim()) {
    combinedFilters.push(filterChain);
  }

  // Step 2: Sticker overlays (before text for proper layering)
  if (stickerFilterChain && stickerFilterChain.trim()) {
    combinedFilters.push(stickerFilterChain);
  }

  // Step 3: Text overlays (on top of everything)
  if (textFilterChain && textFilterChain.trim()) {
    combinedFilters.push(textFilterChain);
  }

  // Apply combined filters if any exist
  if (combinedFilters.length > 0) {
    // For complex filters with multiple inputs, use filter_complex
    if (stickerSources && stickerSources.length > 0) {
      args.push("-filter_complex", combinedFilters.join(';'));
    } else {
      // Simple filters can use -vf
      args.push("-vf", combinedFilters.join(','));
    }
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
      const audioInputIndex = 1 + stickerCount; // Account for stickers
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
        // No delay needed
        args.push("-map", "0:v", "-map", `${audioInputIndex}:a`);
      }
    } else {
      // Multiple audio files - mix them together
      const filterParts: string[] = [];
      const inputMaps: string[] = [];

      audioFiles.forEach((audioFile: AudioFile, index: number) => {
        // Adjust index to account for stickers: video [0] + stickers + audio
        const inputIndex: number = index + 1 + stickerCount;
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
  StickerSource,
};
