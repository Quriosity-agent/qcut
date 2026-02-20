/**
 * FFmpeg Utility Functions
 *
 * Reusable FFmpeg utilities that don't depend on IPC.
 * These functions can be imported and used across multiple modules.
 */

import { spawn, spawnSync } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import type {
	VideoProbeResult,
	FFmpegProgress,
	QualitySettings,
	FFmpegHealthResult,
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

interface StagedBinarySearchResult {
	resolvedPath: string | null;
	searchedPaths: string[];
}

function getBinaryName({
	tool,
	platform,
}: {
	tool: "ffmpeg" | "ffprobe";
	platform: string;
}): string {
	if (platform === "win32") {
		return `${tool}.exe`;
	}
	return tool;
}

function getPreferredTargetKeys(): string[] {
	const exactTarget = `${process.platform}-${process.arch}`;
	return [exactTarget];
}

function resolveStagedBinaryFromRoot({
	rootPath,
	binaryName,
}: {
	rootPath: string;
	binaryName: string;
}): StagedBinarySearchResult {
	const targetKeys = getPreferredTargetKeys();
	const searchedPaths = targetKeys.map((targetKey) =>
		path.join(rootPath, targetKey, binaryName)
	);

	for (const candidatePath of searchedPaths) {
		if (fs.existsSync(candidatePath)) {
			return { resolvedPath: candidatePath, searchedPaths };
		}
	}

	return { resolvedPath: null, searchedPaths };
}

function getDevStagedRootCandidates(): string[] {
	const candidates = [
		path.join(process.cwd(), "electron", "resources", "ffmpeg"),
		path.join(__dirname, "..", "..", "..", "electron", "resources", "ffmpeg"),
		path.join(__dirname, "..", "resources", "ffmpeg"),
	];
	return Array.from(new Set(candidates));
}

function resolveStagedBinaryFromCandidates({
	rootPaths,
	binaryName,
}: {
	rootPaths: string[];
	binaryName: string;
}): StagedBinarySearchResult {
	const searchedPaths: string[] = [];

	for (const rootPath of rootPaths) {
		const result = resolveStagedBinaryFromRoot({ rootPath, binaryName });
		searchedPaths.push(...result.searchedPaths);
		if (result.resolvedPath) {
			return {
				resolvedPath: result.resolvedPath,
				searchedPaths,
			};
		}
	}

	return { resolvedPath: null, searchedPaths };
}

function isBinaryExecutable({ binaryPath }: { binaryPath: string }): boolean {
	try {
		const result = spawnSync(binaryPath, ["-version"], {
			timeout: 2500,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

function resolvePackagedStagedBinaryOrThrow({
	binaryName,
	toolName,
}: {
	binaryName: string;
	toolName: string;
}): string {
	const packagedRootPath = path.join(process.resourcesPath, "ffmpeg");
	const result = resolveStagedBinaryFromRoot({
		rootPath: packagedRootPath,
		binaryName,
	});

	if (result.resolvedPath) {
		console.log(
			`[FFmpeg] Using staged ${toolName} binary from packaged resources:`,
			result.resolvedPath
		);
		return result.resolvedPath;
	}

	const searchDetails = result.searchedPaths.join(", ");
	throw new Error(
		`${toolName} staged binary not found in packaged app. Expected one of: ${searchDetails}`
	);
}

/**
 * Resolves FFmpeg binary path for current environment (dev/packaged).
 *
 * Search order:
 * - Packaged: staged binary only (`process.resourcesPath/ffmpeg/<platform>-<arch>/`)
 * - Development: staged binary → ffmpeg-static → system install → PATH
 */
export function getFFmpegPath(): string {
	const platform = process.platform;
	const binaryName = getBinaryName({ tool: "ffmpeg", platform });

	if (app.isPackaged) {
		return resolvePackagedStagedBinaryOrThrow({
			binaryName,
			toolName: "FFmpeg",
		});
	}

	const devStagedResult = resolveStagedBinaryFromCandidates({
		rootPaths: getDevStagedRootCandidates(),
		binaryName,
	});
	if (devStagedResult.resolvedPath) {
		console.log(
			"[FFmpeg] Using staged FFmpeg binary in development:",
			devStagedResult.resolvedPath
		);
		return devStagedResult.resolvedPath;
	}

	try {
		const staticPath: string = require("ffmpeg-static");
		if (fs.existsSync(staticPath)) {
			console.log("[FFmpeg] Found ffmpeg-static:", staticPath);
			return staticPath;
		}
	} catch {
		console.log("[FFmpeg] ffmpeg-static package not available in development");
	}

	const systemPaths = getSystemFFmpegPaths(platform, binaryName);
	for (const searchPath of systemPaths) {
		if (fs.existsSync(searchPath)) {
			console.log("[FFmpeg] Found FFmpeg at system path:", searchPath);
			return searchPath;
		}
	}

	console.log("[FFmpeg] Falling back to system PATH:", binaryName);
	return binaryName;
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
 * Resolves FFprobe binary path.
 *
 * Search order:
 * - Packaged: staged binary only (`process.resourcesPath/ffmpeg/<platform>-<arch>/`)
 * - Development: staged binary → ffprobe-static (executable) → system install → FFmpeg dir → PATH
 */
export function getFFprobePath(): string {
	const platform = process.platform;
	const binaryName = getBinaryName({ tool: "ffprobe", platform });

	if (app.isPackaged) {
		return resolvePackagedStagedBinaryOrThrow({
			binaryName,
			toolName: "FFprobe",
		});
	}

	const devStagedResult = resolveStagedBinaryFromCandidates({
		rootPaths: getDevStagedRootCandidates(),
		binaryName,
	});
	if (devStagedResult.resolvedPath) {
		if (isBinaryExecutable({ binaryPath: devStagedResult.resolvedPath })) {
			console.log(
				"[FFmpeg] Using staged FFprobe binary in development:",
				devStagedResult.resolvedPath
			);
			return devStagedResult.resolvedPath;
		}
		console.log(
			"[FFmpeg] Staged FFprobe binary exists but failed executable check:",
			devStagedResult.resolvedPath
		);
	}

	try {
		const staticPath: string = require("ffprobe-static").path;
		if (
			fs.existsSync(staticPath) &&
			isBinaryExecutable({ binaryPath: staticPath })
		) {
			console.log("[FFmpeg] Found ffprobe-static:", staticPath);
			return staticPath;
		}
	} catch {
		console.log("[FFmpeg] ffprobe-static package not available in development");
	}

	const systemPaths = getSystemFFmpegPaths(platform, binaryName);
	for (const searchPath of systemPaths) {
		if (!fs.existsSync(searchPath)) {
			continue;
		}
		if (!isBinaryExecutable({ binaryPath: searchPath })) {
			continue;
		}
		console.log("[FFmpeg] Found FFprobe at system path:", searchPath);
		return searchPath;
	}

	const ffmpegPath = getFFmpegPath();
	const ffmpegDir = path.dirname(ffmpegPath);

	if (ffmpegPath === "ffmpeg" || ffmpegPath === "ffmpeg.exe") {
		console.log("[FFmpeg] Falling back to system PATH FFprobe");
		return binaryName;
	}

	const ffprobeFromFFmpegDir = path.join(ffmpegDir, binaryName);
	if (fs.existsSync(ffprobeFromFFmpegDir)) {
		console.log(
			"[FFmpeg] Using FFprobe from FFmpeg directory:",
			ffprobeFromFFmpegDir
		);
		return ffprobeFromFFmpegDir;
	}

	console.log(
		"[FFmpeg] Falling back to system PATH FFprobe binary name:",
		binaryName
	);
	return binaryName;
}

// ============================================================================
// Health Check
// ============================================================================

/** Timeout for health check spawn (ms) */
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * Spawns a binary with `-version` and extracts the version string.
 *
 * @param binaryPath - Absolute path to the binary
 * @param binaryName - Human-readable name for logging (e.g., "FFmpeg")
 * @returns Promise resolving to `{ ok, version, error }`
 */
function checkBinaryVersion(
	binaryPath: string,
	binaryName: string
): Promise<{ ok: boolean; version: string; error: string }> {
	return new Promise((resolve) => {
		try {
			const proc = spawn(binaryPath, ["-version"], {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const timeoutId = setTimeout(() => {
				proc.kill();
				resolve({
					ok: false,
					version: "",
					error: `${binaryName} timed out after ${HEALTH_CHECK_TIMEOUT}ms`,
				});
			}, HEALTH_CHECK_TIMEOUT);

			let stdout = "";

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			proc.on("close", (code: number | null) => {
				clearTimeout(timeoutId);
				if (code === 0) {
					// Parse version from first line: "ffmpeg version 6.1.1 ..."
					const firstLine = stdout.split("\n")[0] ?? "";
					const versionMatch = firstLine.match(/version\s+([\d.]+)/);
					resolve({
						ok: true,
						version: versionMatch?.[1] ?? "unknown",
						error: "",
					});
				} else {
					resolve({
						ok: false,
						version: "",
						error: `${binaryName} exited with code ${code}`,
					});
				}
			});

			proc.on("error", (err: Error) => {
				clearTimeout(timeoutId);
				resolve({
					ok: false,
					version: "",
					error: `${binaryName} spawn error: ${err.message}`,
				});
			});
		} catch (err: any) {
			resolve({
				ok: false,
				version: "",
				error: `${binaryName} check failed: ${err.message}`,
			});
		}
	});
}

/**
 * Verifies FFmpeg and FFprobe binaries are executable at runtime.
 *
 * Spawns `ffmpeg -version` and `ffprobe -version` with a 5-second timeout,
 * parses version strings, and returns a health result. Uses `console.log`
 * (not `debugLog`) so output appears in production builds via electron-log.
 *
 * @returns Promise resolving to health check result with version info and errors
 */
export async function verifyFFmpegBinary(): Promise<FFmpegHealthResult> {
	const ffmpegPath = getFFmpegPath();
	const ffprobePath = getFFprobePath();

	console.log("[FFmpeg Health] Checking binary availability...");
	console.log(`[FFmpeg Health] FFmpeg path: ${ffmpegPath}`);
	console.log(`[FFmpeg Health] FFprobe path: ${ffprobePath}`);

	const [ffmpegResult, ffprobeResult] = await Promise.all([
		checkBinaryVersion(ffmpegPath, "FFmpeg"),
		checkBinaryVersion(ffprobePath, "FFprobe"),
	]);

	const errors: string[] = [];
	if (!ffmpegResult.ok) errors.push(ffmpegResult.error);
	if (!ffprobeResult.ok) errors.push(ffprobeResult.error);

	const result: FFmpegHealthResult = {
		ffmpegOk: ffmpegResult.ok,
		ffprobeOk: ffprobeResult.ok,
		ffmpegVersion: ffmpegResult.version,
		ffprobeVersion: ffprobeResult.version,
		ffmpegPath,
		ffprobePath,
		errors,
	};

	if (result.ffmpegOk && result.ffprobeOk) {
		console.log(
			`[FFmpeg Health] OK — FFmpeg ${result.ffmpegVersion}, FFprobe ${result.ffprobeVersion}`
		);
	} else {
		console.error("[FFmpeg Health] FAILED:", errors.join("; "));
	}

	return result;
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

				const hasAudio = probeData.streams?.some(
					(s: any) => s.codec_type === "audio"
				);

				resolve({
					path: videoPath,
					codec: videoStream.codec_name,
					width: videoStream.width,
					height: videoStream.height,
					pix_fmt: videoStream.pix_fmt,
					fps: videoStream.r_frame_rate,
					hasAudio: !!hasAudio,
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
