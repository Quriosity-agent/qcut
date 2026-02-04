/**
 * FFmpeg Utility Functions
 *
 * Reusable FFmpeg utilities that don't depend on IPC.
 * These functions can be imported and used across multiple modules.
 */

import { spawn } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import type {
  VideoProbeResult,
  FFmpegProgress,
  QualitySettings,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Maximum video duration for export (10 minutes) */
export const MAX_EXPORT_DURATION = 600;

/** Quality presets mapping quality levels to FFmpeg encoding parameters */
export const QUALITY_SETTINGS: Record<string, QualitySettings> = {
  high: { crf: "18", preset: "slow" },
  medium: { crf: "23", preset: "fast" },
  low: { crf: "28", preset: "veryfast" },
};

// ============================================================================
// Debug Logging
// ============================================================================

/**
 * Debug logging for development mode only.
 * Logs are prefixed with [FFmpeg] for easy filtering.
 */
export const debugLog = (...args: any[]): void => {
  if (process.env.NODE_ENV !== "production") {
    console.log("[FFmpeg]", ...args);
  }
};

/**
 * Debug warning for development mode only.
 */
export const debugWarn = (...args: any[]): void => {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[FFmpeg]", ...args);
  }
};

/**
 * Debug error for development mode only.
 */
export const debugError = (...args: any[]): void => {
  if (process.env.NODE_ENV !== "production") {
    console.error("[FFmpeg]", ...args);
  }
};

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolves FFmpeg binary path for current environment (dev/packaged).
 *
 * Packaged apps expect FFmpeg in resources folder; dev mode searches
 * bundled resources then system paths. Supports Windows, macOS, and Linux.
 *
 * Search order:
 * 1. Packaged app resources folder
 * 2. Development bundled resources
 * 3. Platform-specific system paths (WinGet/Homebrew/apt)
 * 4. System PATH fallback
 *
 * @returns Absolute path to FFmpeg binary or "ffmpeg"/"ffmpeg.exe" for system PATH
 * @throws Error if FFmpeg not found in packaged app resources
 */
export function getFFmpegPath(): string {
  const platform = process.platform;
  const binaryName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  let ffmpegPath: string;

  if (app.isPackaged) {
    // Production: FFmpeg is in the app's resources folder
    // extraResources config copies platform-specific binaries to resources/
    const resourcePath: string = path.join(process.resourcesPath, binaryName);

    if (fs.existsSync(resourcePath)) {
      ffmpegPath = resourcePath;
    } else {
      // In packaged app, FFmpeg should exist - throw error
      throw new Error(`FFmpeg not found at: ${resourcePath}`);
    }
  } else {
    // Development: try bundled FFmpeg first, then system paths, then PATH
    const devPath: string = path.join(__dirname, "..", "resources", binaryName);

    if (fs.existsSync(devPath)) {
      ffmpegPath = devPath;
      debugLog("Found bundled FFmpeg:", ffmpegPath);
    } else {
      // Search platform-specific system paths
      const systemPaths = getSystemFFmpegPaths(platform, binaryName);
      let foundPath: string | null = null;

      for (const searchPath of systemPaths) {
        if (fs.existsSync(searchPath)) {
          foundPath = searchPath;
          debugLog("Found FFmpeg at:", searchPath);
          break;
        }
      }

      if (foundPath) {
        ffmpegPath = foundPath;
      } else {
        // Fallback to system PATH
        ffmpegPath = binaryName;
        debugLog("Falling back to system PATH:", binaryName);
      }
    }
  }

  // Verify FFmpeg exists (skip verification for system PATH fallback)
  if (ffmpegPath !== binaryName && !fs.existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg not found at: ${ffmpegPath}`);
  }

  return ffmpegPath;
}

/**
 * Returns platform-specific paths where FFmpeg might be installed.
 * Preserves existing Windows behavior (WinGet, Chocolatey, Scoop).
 *
 * @param platform - The current platform (win32, darwin, linux)
 * @param binaryName - The binary name to search for
 * @returns Array of paths to check
 */
function getSystemFFmpegPaths(platform: string, binaryName: string): string[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";

  switch (platform) {
    case "win32": {
      // Windows: WinGet, Chocolatey, Scoop (preserves existing behavior)
      const paths: string[] = [];

      // WinGet installation (existing behavior)
      const wingetBasePath = path.join(
        homeDir,
        "AppData",
        "Local",
        "Microsoft",
        "WinGet",
        "Packages"
      );
      if (fs.existsSync(wingetBasePath)) {
        const wingetPath = findFFmpegInWinget(wingetBasePath);
        if (wingetPath) {
          paths.push(wingetPath);
        }
      }

      // Chocolatey
      paths.push("C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe");

      // Scoop
      paths.push(path.join(homeDir, "scoop", "shims", "ffmpeg.exe"));

      return paths;
    }

    case "darwin":
      // macOS: Homebrew (Apple Silicon first, then Intel), MacPorts
      return [
        "/opt/homebrew/bin/ffmpeg", // Homebrew (Apple Silicon M1/M2/M3)
        "/usr/local/bin/ffmpeg", // Homebrew (Intel)
        "/opt/local/bin/ffmpeg", // MacPorts
      ];

    case "linux":
      // Linux: Standard paths, Snap, Flatpak user bin
      return [
        "/usr/bin/ffmpeg", // Most distros (apt, dnf, pacman)
        "/usr/local/bin/ffmpeg", // Manual installation
        "/snap/bin/ffmpeg", // Snap package
        path.join(homeDir, ".local", "bin", "ffmpeg"), // Flatpak user bin
      ];

    default:
      debugWarn(`Unknown platform: ${platform}`);
      return [];
  }
}

/**
 * Searches for FFmpeg binary in winget packages directory.
 * @param wingetBasePath - Base path to winget packages
 * @returns Path to ffmpeg.exe if found, null otherwise
 */
function findFFmpegInWinget(wingetBasePath: string): string | null {
  try {
    const packages = fs.readdirSync(wingetBasePath);
    for (const pkg of packages) {
      if (pkg.toLowerCase().includes("ffmpeg")) {
        const pkgPath = path.join(wingetBasePath, pkg);
        // Search for ffmpeg.exe recursively (usually in bin folder)
        const ffmpegExe = findFileRecursive(pkgPath, "ffmpeg.exe", 3);
        if (ffmpegExe) {
          return ffmpegExe;
        }
      }
    }
  } catch (err) {
    debugWarn("Error searching winget packages:", err);
  }
  return null;
}

/**
 * Recursively searches for a file up to a certain depth.
 * @param dir - Directory to search
 * @param filename - File to find
 * @param maxDepth - Maximum recursion depth
 * @returns Full path to file if found, null otherwise
 */
function findFileRecursive(
  dir: string,
  filename: string,
  maxDepth: number
): string | null {
  if (maxDepth <= 0) return null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isFile() &&
        entry.name.toLowerCase() === filename.toLowerCase()
      ) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (err) {
    // Ignore permission errors
  }
  return null;
}

/**
 * Resolves FFprobe binary path (same directory as FFmpeg).
 *
 * @returns Absolute path to FFprobe binary
 */
export function getFFprobePath(): string {
  const ffmpegPath = getFFmpegPath();
  const ffmpegDir = path.dirname(ffmpegPath);
  const ffprobeExe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";

  // If ffmpeg is system PATH, assume ffprobe is too
  if (ffmpegPath === "ffmpeg") {
    return "ffprobe";
  }

  return path.join(ffmpegDir, ffprobeExe);
}

// ============================================================================
// Progress Parsing
// ============================================================================

/**
 * Extracts progress information from FFmpeg stderr output.
 *
 * FFmpeg writes progress to stderr (not stdout); this parser extracts
 * frame numbers and timestamps for UI progress updates.
 *
 * @param output - Raw stderr text from FFmpeg process
 * @returns Parsed frame/time data, or null if no progress info found
 */
export function parseProgress(output: string): FFmpegProgress | null {
  const frameMatch: RegExpMatchArray | null = output.match(/frame=\s*(\d+)/);
  const timeMatch: RegExpMatchArray | null = output.match(
    /time=(\d+:\d+:\d+\.\d+)/
  );

  if (frameMatch || timeMatch) {
    return {
      frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : null,
      time: timeMatch ? timeMatch[1] : null,
    };
  }
  return null;
}

// ============================================================================
// Video Probing
// ============================================================================

/**
 * Probes a video file to extract codec information using ffprobe.
 * Used for validating codec compatibility in direct-copy mode.
 *
 * @param videoPath - Absolute path to video file
 * @returns Promise resolving to video stream properties
 * @throws Error if ffprobe fails or video stream not found
 */
export async function probeVideoFile(
  videoPath: string
): Promise<VideoProbeResult> {
  const ffprobePath = getFFprobePath();

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

    // Set up timeout - must be cleared on close/error to prevent race condition
    const timeoutId = setTimeout(() => {
      ffprobe.kill();
      reject(new Error(`ffprobe timeout for: ${videoPath}`));
    }, 10_000);

    let stdout = "";
    let stderr = "";

    ffprobe.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      clearTimeout(timeoutId);

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
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

// ============================================================================
// Video Normalization (Mode 1.5)
// ============================================================================

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
 * - Audio sync: `aresample=async=1` filter prevents desync during fps conversion
 * - Overwrite: `-y` flag for automated workflows
 * - Progress monitoring: Parses FFmpeg stderr for frame progress
 *
 * Performance characteristics:
 * - ~0.5-1s per video with ultrafast preset
 * - CRF 18 = visually lossless quality
 * - Audio transcoded to AAC 48kHz stereo for concat compatibility
 *
 * @param inputPath - Absolute path to source video file
 * @param outputPath - Absolute path for normalized output (in temp directory)
 * @param targetWidth - Target width in pixels (from export settings)
 * @param targetHeight - Target height in pixels (from export settings)
 * @param targetFps - Target frame rate (from export settings)
 * @param duration - Duration to use from this video (seconds)
 * @param trimStart - Trim start time within the source video (seconds, 0 = no trim)
 * @param trimEnd - Trim amount from the end of the video (seconds, 0 = no trim)
 * @param onProgress - Optional callback for reporting encoding progress
 * @returns Promise that resolves when normalization completes
 * @throws Error if FFmpeg process fails or file not found
 */
export async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  duration: number,
  trimStart = 0,
  trimEnd = 0,
  onProgress?: (progress: FFmpegProgress) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(
      "⚡ [MODE 1.5 NORMALIZE] ============================================"
    );
    console.log("⚡ [MODE 1.5 NORMALIZE] Starting video normalization...");
    console.log(`⚡ [MODE 1.5 NORMALIZE] Input: ${path.basename(inputPath)}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Output: ${path.basename(outputPath)}`);
    console.log(
      `⚡ [MODE 1.5 NORMALIZE] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`
    );
    console.log("⚡ [MODE 1.5 NORMALIZE] 📏 DURATION CHECK:");
    console.log(
      `⚡ [MODE 1.5 NORMALIZE]   - Input duration parameter: ${duration}s (this is what should be preserved)`
    );
    console.log(`⚡ [MODE 1.5 NORMALIZE]   - Trim start: ${trimStart}s`);
    console.log(`⚡ [MODE 1.5 NORMALIZE]   - Trim end: ${trimEnd}s`);

    // Calculate effective duration (preserve original video length)
    const effectiveDuration = duration - trimStart - trimEnd;
    console.log(
      `⚡ [MODE 1.5 NORMALIZE]   - Calculated effective duration: ${effectiveDuration}s`
    );
    console.log(
      "⚡ [MODE 1.5 NORMALIZE]   - This will be set with FFmpeg -t parameter"
    );

    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      const error = `Video source not found: ${inputPath}`;
      console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
      reject(new Error(error));
      return;
    }

    // Build FFmpeg filter chain for padding
    const filterChain = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;
    console.log(`⚡ [MODE 1.5 NORMALIZE] Filter chain: ${filterChain}`);

    const args: string[] = ["-y"]; // Overwrite output

    // Apply trim start (seek to position) BEFORE input for faster seeking
    if (trimStart && trimStart > 0) {
      args.push("-ss", trimStart.toString());
      console.log(
        `⚡ [MODE 1.5 NORMALIZE] Applying input seek: -ss ${trimStart}s`
      );
    }

    // Input file
    args.push("-i", inputPath);

    // Set effective duration (duration after trimming)
    if (effectiveDuration > 0) {
      args.push("-t", effectiveDuration.toString());
      console.log(
        `⚡ [MODE 1.5 NORMALIZE] Setting output duration: -t ${effectiveDuration}s`
      );
    } else {
      console.warn(
        `⚠️ [MODE 1.5 NORMALIZE] Invalid effective duration: ${effectiveDuration}s, skipping duration parameter`
      );
    }

    // Video filters (scale + pad)
    args.push("-vf", filterChain);

    // Frame rate conversion
    args.push("-r", targetFps.toString());

    // Video encoding settings
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p"
    );

    // Audio settings - normalize to AAC for concat compatibility
    console.log(
      "🎧 [MODE 1.5 NORMALIZE] Transcoding audio to AAC 48kHz stereo for compatibility..."
    );
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");

    // Audio sync (critical for fps conversion)
    args.push("-af", "aresample=async=1");

    // Output file
    args.push(outputPath);

    console.log(
      `⚡ [MODE 1.5 NORMALIZE] FFmpeg command: ffmpeg ${args.join(" ")}`
    );
    console.log("⚡ [MODE 1.5 NORMALIZE] Starting FFmpeg process...");

    // Get FFmpeg path
    const ffmpegPath = getFFmpegPath();

    // Spawn FFmpeg process
    const ffmpegProcess = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrOutput = "";
    let stdoutOutput = "";

    // Capture stdout
    ffmpegProcess.stdout?.on("data", (chunk: Buffer) => {
      stdoutOutput += chunk.toString();
    });

    // Capture stderr for progress and errors
    ffmpegProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;

      // Parse and report progress
      const progress = parseProgress(text);
      if (progress) {
        onProgress?.(progress);

        // Also log to console for debugging
        const frame = progress.frame ?? "?";
        const time = progress.time ?? "?";
        process.stdout.write(
          `⚡ [MODE 1.5 NORMALIZE] Progress: frame=${frame} time=${time}\r`
        );
      }
    });

    // Handle process completion
    ffmpegProcess.on("close", (code: number | null) => {
      process.stdout.write("\n"); // Clear progress line

      if (code === 0) {
        // Verify output file was created
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(
            `⚡ [MODE 1.5 NORMALIZE] ✅ Normalization complete: ${path.basename(outputPath)}`
          );
          console.log(
            `⚡ [MODE 1.5 NORMALIZE] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
          );

          // Verify output duration
          verifyOutputDuration(outputPath, effectiveDuration)
            .then(() => resolve())
            .catch(() => resolve()); // Resolve even if verification fails
        } else {
          const error = `Output file not created: ${outputPath}`;
          console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
          reject(new Error(error));
        }
      } else {
        console.error(
          `❌ [MODE 1.5 NORMALIZE] Normalization failed with code ${code}`
        );
        console.error(
          `❌ [MODE 1.5 NORMALIZE] FFmpeg stderr:\n${stderrOutput}`
        );
        console.error(
          "❌ [MODE 1.5 NORMALIZE] ============================================"
        );
        reject(new Error(`FFmpeg normalization failed with code ${code}`));
      }
    });

    // Handle process errors
    ffmpegProcess.on("error", (error: Error) => {
      console.error("❌ [MODE 1.5 NORMALIZE] FFmpeg process error:", error);
      console.error(
        "❌ [MODE 1.5 NORMALIZE] ============================================"
      );
      reject(error);
    });
  });
}

/**
 * Verify output video duration matches expected duration.
 * Uses ffprobe to check actual duration of normalized video.
 *
 * @param outputPath - Path to the output video file
 * @param expectedDuration - Expected duration in seconds
 */
async function verifyOutputDuration(
  outputPath: string,
  expectedDuration: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log("⚡ [MODE 1.5 NORMALIZE] 📏 VERIFYING OUTPUT DURATION...");
    const ffprobePath = getFFprobePath();

    const probeProcess = spawn(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let actualDuration = "";
    probeProcess.stdout?.on("data", (chunk: Buffer) => {
      actualDuration += chunk.toString().trim();
    });

    probeProcess.on("close", (probeCode: number | null) => {
      if (probeCode === 0 && actualDuration) {
        const actualDurationFloat = parseFloat(actualDuration);
        console.log(
          `⚡ [MODE 1.5 NORMALIZE]   - Expected duration: ${expectedDuration}s`
        );
        console.log(
          `⚡ [MODE 1.5 NORMALIZE]   - Actual duration: ${actualDurationFloat.toFixed(2)}s`
        );
        const difference = Math.abs(actualDurationFloat - expectedDuration);
        if (difference > 0.1) {
          console.warn(
            `⚠️ [MODE 1.5 NORMALIZE]   - DURATION MISMATCH: Difference of ${difference.toFixed(2)}s detected!`
          );
        } else {
          console.log(
            "⚡ [MODE 1.5 NORMALIZE]   - ✅ Duration preserved correctly (within 0.1s tolerance)"
          );
        }
      } else {
        console.log(
          "⚡ [MODE 1.5 NORMALIZE]   - Could not verify actual duration (ffprobe unavailable)"
        );
      }
      console.log(
        "⚡ [MODE 1.5 NORMALIZE] ============================================"
      );
      resolve();
    });

    probeProcess.on("error", () => {
      console.log(
        "⚡ [MODE 1.5 NORMALIZE]   - Could not verify actual duration (ffprobe error)"
      );
      console.log(
        "⚡ [MODE 1.5 NORMALIZE] ============================================"
      );
      resolve();
    });
  });
}
