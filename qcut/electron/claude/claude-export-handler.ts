/**
 * Claude Export API Handler
 * Provides export presets, recommendations, and background export jobs.
 */

import { app, ipcMain, IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { getFFmpegPath, parseProgress } from "../ffmpeg/utils.js";
import { claudeLog } from "./utils/logger.js";
import { logOperation } from "./claude-operation-log.js";
import type {
	ClaudeTimeline,
	ClaudeElement,
	ExportPreset,
	ExportRecommendation,
	ExportJobRequest,
	ExportJobStatus,
	MediaFile,
} from "../types/claude-api";

const HANDLER_NAME = "Export";

const EXPORT_JOB_STATUS = {
	queued: "queued",
	exporting: "exporting",
	completed: "completed",
	failed: "failed",
} as const;

const MAX_JOBS = 50;

interface ExportSegment {
	sourcePath: string;
	startTime: number;
	duration: number;
	sourceId: string;
}

interface ResolvedExportSettings {
	presetId: string;
	width: number;
	height: number;
	fps: number;
	format: string;
	codec: string;
	bitrate: string;
}

interface ExportJobInternal extends ExportJobStatus {
	projectId: string;
	presetId: string;
	settings: ResolvedExportSettings;
}

interface ProgressEventPayload {
	jobId?: string;
	progress?: number;
	currentFrame?: number;
	totalFrames?: number;
	fps?: number;
	estimatedTimeRemaining?: number;
}

// In-memory job tracking (cleared on app restart)
const exportJobs = new Map<string, ExportJobInternal>();

// Platform-specific export presets
export const PRESETS: ExportPreset[] = [
	{
		id: "youtube-4k",
		name: "YouTube 4K",
		platform: "youtube",
		width: 3840,
		height: 2160,
		fps: 60,
		bitrate: "45Mbps",
		format: "mp4",
	},
	{
		id: "youtube-1080p",
		name: "YouTube 1080p",
		platform: "youtube",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "8Mbps",
		format: "mp4",
	},
	{
		id: "youtube-720p",
		name: "YouTube 720p",
		platform: "youtube",
		width: 1280,
		height: 720,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "tiktok",
		name: "TikTok",
		platform: "tiktok",
		width: 1080,
		height: 1920,
		fps: 30,
		bitrate: "6Mbps",
		format: "mp4",
	},
	{
		id: "instagram-reel",
		name: "Instagram Reel",
		platform: "instagram",
		width: 1080,
		height: 1920,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "instagram-post",
		name: "Instagram Post (Square)",
		platform: "instagram",
		width: 1080,
		height: 1080,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "instagram-landscape",
		name: "Instagram Post (Landscape)",
		platform: "instagram",
		width: 1080,
		height: 566,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "twitter",
		name: "Twitter/X",
		platform: "twitter",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "6Mbps",
		format: "mp4",
	},
	{
		id: "linkedin",
		name: "LinkedIn",
		platform: "linkedin",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "8Mbps",
		format: "mp4",
	},
	{
		id: "discord",
		name: "Discord (8MB limit)",
		platform: "discord",
		width: 1280,
		height: 720,
		fps: 30,
		bitrate: "2Mbps",
		format: "mp4",
	},
];

function sanitizeFileName({ input }: { input: string }): string {
	try {
		return input.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	} catch {
		return "export";
	}
}

function parseBitrateForKbps({ bitrate }: { bitrate: string }): string {
	try {
		const normalized = bitrate.trim().toLowerCase();
		if (normalized.endsWith("mbps")) {
			const value = Number.parseFloat(normalized.replace("mbps", ""));
			if (Number.isFinite(value) && value > 0) {
				return `${Math.round(value * 1000)}k`;
			}
		}
		if (normalized.endsWith("kbps")) {
			const value = Number.parseFloat(normalized.replace("kbps", ""));
			if (Number.isFinite(value) && value > 0) {
				return `${Math.round(value)}k`;
			}
		}
		return "8000k";
	} catch {
		return "8000k";
	}
}

function parseTimecodeToSeconds({
	timecode,
}: {
	timecode: string | null;
}): number {
	try {
		if (!timecode) {
			return 0;
		}
		const [hoursRaw, minutesRaw, secondsRaw] = timecode.split(":");
		const hours = Number.parseFloat(hoursRaw);
		const minutes = Number.parseFloat(minutesRaw);
		const seconds = Number.parseFloat(secondsRaw);
		if (
			!Number.isFinite(hours) ||
			!Number.isFinite(minutes) ||
			!Number.isFinite(seconds)
		) {
			return 0;
		}
		return hours * 3600 + minutes * 60 + seconds;
	} catch {
		return 0;
	}
}

function clampProgress({ value }: { value: number }): number {
	try {
		if (!Number.isFinite(value)) {
			return 0;
		}
		return Math.min(1, Math.max(0, value));
	} catch {
		return 0;
	}
}

function pruneOldJobs(): void {
	try {
		if (exportJobs.size <= MAX_JOBS) {
			return;
		}
		const oldest = [...exportJobs.entries()].sort(
			(a, b) => a[1].startedAt - b[1].startedAt
		);
		const removeCount = oldest.length - MAX_JOBS;
		for (let i = 0; i < removeCount; i++) {
			exportJobs.delete(oldest[i][0]);
		}
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to prune old export jobs:", error);
	}
}

function getDefaultOutputPath({
	projectId,
	format,
}: {
	projectId: string;
	format: string;
}): string {
	try {
		const now = new Date();
		const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
		const safeProjectId = sanitizeFileName({ input: projectId }) || "project";
		const extension = format || "mp4";
		return path.join(
			app.getPath("documents"),
			"QCut",
			"Exports",
			`${safeProjectId}-${stamp}.${extension}`
		);
	} catch {
		return path.join(
			app.getPath("documents"),
			"QCut",
			"Exports",
			`export-${Date.now()}.mp4`
		);
	}
}

function findPresetById({
	presetId,
}: {
	presetId: string;
}): ExportPreset | null {
	try {
		return PRESETS.find((preset) => preset.id === presetId) ?? null;
	} catch {
		return null;
	}
}

function resolveExportSettings({
	request,
}: {
	request: ExportJobRequest;
}): ResolvedExportSettings {
	try {
		const requestedPresetId = request.preset?.trim() || "youtube-1080p";
		const preset = findPresetById({ presetId: requestedPresetId });
		if (!preset) {
			throw new Error(`Invalid preset ID: ${requestedPresetId}`);
		}

		return {
			presetId: preset.id,
			width: request.settings?.width ?? preset.width,
			height: request.settings?.height ?? preset.height,
			fps: request.settings?.fps ?? preset.fps,
			format: request.settings?.format ?? preset.format,
			codec: request.settings?.codec ?? "libx264",
			bitrate: request.settings?.bitrate ?? preset.bitrate,
		};
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to resolve export settings");
	}
}

function findMediaForElement({
	element,
	mediaById,
	mediaByName,
}: {
	element: ClaudeElement;
	mediaById: Map<string, MediaFile>;
	mediaByName: Map<string, MediaFile>;
}): MediaFile | null {
	// 1. Try matching by deterministic Claude API ID (element.sourceId === mediaFile.id)
	if (element.sourceId) {
		const byId = mediaById.get(element.sourceId);
		if (byId) return byId;
	}

	// 2. Try matching by sourceName (filename)
	if (element.sourceName) {
		const byName = mediaByName.get(element.sourceName);
		if (byName) return byName;
	}

	// 3. Try decoding sourceId as a deterministic media ID to get filename
	if (element.sourceId?.startsWith("media_")) {
		try {
			const encoded = element.sourceId.slice("media_".length);
			const decoded = Buffer.from(encoded, "base64url").toString("utf8");
			if (decoded) {
				const byDecoded = mediaByName.get(decoded);
				if (byDecoded) return byDecoded;
			}
		} catch {
			// Not a valid base64url — ignore
		}
	}

	// 4. Try matching Zustand UUID sourceId against media names/paths
	//    (when renderer provides sourceId as internal UUID, match by name instead)
	if (element.sourceId && !mediaById.has(element.sourceId)) {
		// sourceId is likely a Zustand internal UUID — can't match by ID.
		// Fall through; already tried sourceName above.
	}

	return null;
}

function collectExportSegments({
	timeline,
	mediaFiles,
}: {
	timeline: ClaudeTimeline;
	mediaFiles: MediaFile[];
}): ExportSegment[] {
	try {
		const mediaById = new Map<string, MediaFile>();
		const mediaByName = new Map<string, MediaFile>();
		for (const mediaFile of mediaFiles) {
			mediaById.set(mediaFile.id, mediaFile);
			mediaByName.set(mediaFile.name, mediaFile);
		}

		const segments: ExportSegment[] = [];

		for (const track of timeline.tracks) {
			for (const element of track.elements) {
				if (!(element.type === "media" || element.type === "video")) {
					continue;
				}

				const media = findMediaForElement({ element, mediaById, mediaByName });
				if (!media || media.type !== "video") {
					continue;
				}

				const durationFromElement =
					typeof element.duration === "number" && element.duration > 0
						? element.duration
						: element.endTime - element.startTime;

				if (!Number.isFinite(durationFromElement) || durationFromElement <= 0) {
					continue;
				}

				segments.push({
					sourcePath: media.path,
					startTime: element.startTime,
					duration: durationFromElement,
					sourceId: media.id,
				});
			}
		}

		segments.sort((a, b) => a.startTime - b.startTime);
		return segments;
	} catch (error) {
		claudeLog.error(HANDLER_NAME, "Failed to collect export segments:", error);
		return [];
	}
}

async function ensureDirectory({
	directory,
}: {
	directory: string;
}): Promise<void> {
	try {
		await fsPromises.mkdir(directory, { recursive: true });
	} catch (error) {
		claudeLog.error(
			HANDLER_NAME,
			`Failed to create directory: ${directory}`,
			error
		);
		throw error;
	}
}

async function runFFmpegCommand({
	args,
	estimatedDuration,
	onProgress,
}: {
	args: string[];
	estimatedDuration: number;
	onProgress?: (progress: {
		normalizedProgress: number;
		currentFrame?: number;
		fps?: number;
		eta?: number;
	}) => void;
}): Promise<void> {
	try {
		const ffmpegPath = getFFmpegPath();

		await new Promise<void>((resolve, reject) => {
			const process = spawn(ffmpegPath, args, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stderrOutput = "";

			process.stderr?.on("data", (chunk: Buffer) => {
				try {
					const text = chunk.toString();
					stderrOutput += text;

					const parsed = parseProgress(text);
					if (!parsed || !onProgress) {
						return;
					}

					const seconds = parseTimecodeToSeconds({
						timecode: parsed.time ?? null,
					});
					const normalizedProgress =
						estimatedDuration > 0
							? clampProgress({ value: seconds / estimatedDuration })
							: 0;

					const currentFrame =
						typeof parsed.frame === "number" && Number.isFinite(parsed.frame)
							? parsed.frame
							: undefined;

					onProgress({
						normalizedProgress,
						currentFrame,
					});
				} catch {
					// Ignore progress parse errors from partial stderr chunks.
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

				const tail = stderrOutput.slice(-1200);
				reject(new Error(`FFmpeg failed with code ${code}. ${tail}`));
			});
		});
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Unknown FFmpeg execution failure");
	}
}

function getActiveJobForProject({
	projectId,
}: {
	projectId: string;
}): ExportJobInternal | null {
	try {
		for (const job of exportJobs.values()) {
			if (job.projectId !== projectId) {
				continue;
			}
			if (
				job.status === EXPORT_JOB_STATUS.queued ||
				job.status === EXPORT_JOB_STATUS.exporting
			) {
				return job;
			}
		}
		return null;
	} catch {
		return null;
	}
}

function updateJobProgress({
	jobId,
	progress,
	currentFrame,
	totalFrames,
	fps,
	estimatedTimeRemaining,
}: {
	jobId: string;
	progress: number;
	currentFrame?: number;
	totalFrames?: number;
	fps?: number;
	estimatedTimeRemaining?: number;
}): void {
	try {
		const job = exportJobs.get(jobId);
		if (!job) {
			return;
		}

		const normalized = clampProgress({ value: progress });
		job.progress = normalized;
		job.currentFrame = currentFrame;
		job.totalFrames = totalFrames;
		job.fps = fps;
		job.estimatedTimeRemaining = estimatedTimeRemaining;

		if (normalized >= 1) {
			job.status = EXPORT_JOB_STATUS.completed;
			job.completedAt = Date.now();
		} else if (job.status !== EXPORT_JOB_STATUS.failed) {
			job.status = EXPORT_JOB_STATUS.exporting;
		}
	} catch (error) {
		claudeLog.warn(
			HANDLER_NAME,
			`Failed to update progress for job ${jobId}:`,
			error
		);
	}
}

async function executeExportJob({
	jobId,
	projectId,
	settings,
	outputPath,
	segments,
}: {
	jobId: string;
	projectId: string;
	settings: ResolvedExportSettings;
	outputPath: string;
	segments: ExportSegment[];
}): Promise<void> {
	const job = exportJobs.get(jobId);
	if (!job) {
		return;
	}

	let tempDir = "";

	try {
		job.status = EXPORT_JOB_STATUS.exporting;
		updateJobProgress({ jobId, progress: 0.02 });

		await ensureDirectory({ directory: path.dirname(outputPath) });

		tempDir = await fsPromises.mkdtemp(
			path.join(app.getPath("temp"), "qcut-claude-export-")
		);

		const segmentOutputs: string[] = [];
		const scaleFilter = `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:black`;
		const totalSegments = segments.length;

		for (const [index, segment] of segments.entries()) {
			const outputSegmentPath = path.join(
				tempDir,
				`segment-${String(index).padStart(4, "0")}.mp4`
			);

			await runFFmpegCommand({
				args: [
					"-y",
					"-i",
					segment.sourcePath,
					"-t",
					String(segment.duration),
					"-vf",
					scaleFilter,
					"-r",
					String(settings.fps),
					"-c:v",
					settings.codec,
					"-preset",
					"medium",
					"-b:v",
					parseBitrateForKbps({ bitrate: settings.bitrate }),
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					outputSegmentPath,
				],
				estimatedDuration: segment.duration,
				onProgress: ({ normalizedProgress, currentFrame }) => {
					const sliceSize = 0.82 / totalSegments;
					const base = (index / totalSegments) * 0.82;
					const progress = base + normalizedProgress * sliceSize;
					updateJobProgress({
						jobId,
						progress,
						currentFrame,
					});
				},
			});

			segmentOutputs.push(outputSegmentPath);
			updateJobProgress({
				jobId,
				progress: ((index + 1) / totalSegments) * 0.82,
			});
		}

		const concatListPath = path.join(tempDir, "concat-list.txt");
		const concatLines = segmentOutputs
			.map((segmentPath) => {
				const escaped = segmentPath.replace(/\\/g, "/").replace(/'/g, "'\\''");
				return `file '${escaped}'`;
			})
			.join("\n");
		await fsPromises.writeFile(concatListPath, concatLines, "utf8");

		updateJobProgress({ jobId, progress: 0.9 });

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
				outputPath,
			],
			estimatedDuration: Math.max(
				0,
				segments.reduce((sum, segment) => sum + segment.duration, 0)
			),
			onProgress: ({ normalizedProgress }) => {
				updateJobProgress({
					jobId,
					progress: 0.9 + normalizedProgress * 0.08,
				});
			},
		});

		const outputStats = await fsPromises.stat(outputPath);
		const duration = segments.reduce(
			(sum, segment) => sum + segment.duration,
			0
		);

		const finishedJob = exportJobs.get(jobId);
		if (!finishedJob) {
			return;
		}

		finishedJob.status = EXPORT_JOB_STATUS.completed;
		finishedJob.progress = 1;
		finishedJob.outputPath = outputPath;
		finishedJob.duration = duration;
		finishedJob.fileSize = outputStats.size;
		finishedJob.completedAt = Date.now();

		logOperation({
			stage: 5,
			action: "export",
			details: `Exported ${settings.presetId} (${path.basename(outputPath)})`,
			timestamp: Date.now(),
			duration,
			projectId,
			metadata: {
				jobId,
				preset: settings.presetId,
				outputPath,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Export failed";
		const failedJob = exportJobs.get(jobId);
		if (failedJob) {
			failedJob.status = EXPORT_JOB_STATUS.failed;
			failedJob.error = message;
			failedJob.completedAt = Date.now();
		}

		logOperation({
			stage: 5,
			action: "export",
			details: `Export failed: ${message}`,
			timestamp: Date.now(),
			projectId,
			metadata: {
				jobId,
				preset: settings.presetId,
			},
		});

		claudeLog.error(HANDLER_NAME, `Export job ${jobId} failed:`, error);
	} finally {
		if (tempDir) {
			try {
				await fsPromises.rm(tempDir, { recursive: true, force: true });
			} catch (cleanupError) {
				claudeLog.warn(
					HANDLER_NAME,
					`Failed to cleanup temp export dir: ${tempDir}`,
					cleanupError
				);
			}
		}
	}
}

function isTimelineEmpty({ timeline }: { timeline: ClaudeTimeline }): boolean {
	try {
		for (const track of timeline.tracks) {
			if (track.elements.length > 0) {
				return false;
			}
		}
		return true;
	} catch {
		return true;
	}
}

/**
 * Get all export presets
 */
export function getExportPresets(): ExportPreset[] {
	claudeLog.info(HANDLER_NAME, "Returning all export presets");
	return PRESETS;
}

/**
 * Get export recommendation for a specific platform/target
 */
export function getExportRecommendation(target: string): ExportRecommendation {
	claudeLog.info(HANDLER_NAME, `Recommending export for target: ${target}`);

	const defaultPreset = PRESETS.find((p) => p.id === "youtube-1080p")!;
	const preset =
		PRESETS.find((p) => p.platform === target || p.id === target) ||
		defaultPreset;

	const warnings: string[] = [];
	const suggestions: string[] = [];

	switch (preset.platform) {
		case "tiktok":
			suggestions.push("Videos under 60 seconds perform best on TikTok");
			suggestions.push(
				"Add captions for better engagement (85% watch without sound)"
			);
			suggestions.push("Use trending sounds when possible");
			warnings.push("Maximum video length is 10 minutes");
			break;

		case "instagram":
			suggestions.push("Reels should be 15-90 seconds for optimal reach");
			suggestions.push("Use trending audio when possible");
			suggestions.push("Add text overlays for accessibility");
			warnings.push("Instagram compresses videos - export at higher quality");
			break;

		case "youtube":
			suggestions.push("Add chapters for longer videos (>10 minutes)");
			suggestions.push("Include end screen in last 20 seconds");
			suggestions.push("Add closed captions for better SEO");
			break;

		case "twitter":
			warnings.push("Maximum video length is 2 minutes 20 seconds");
			suggestions.push("Keep it concise for better engagement");
			suggestions.push("Add captions - Twitter autoplays muted");
			break;

		case "linkedin":
			suggestions.push("Professional content performs best");
			suggestions.push("Keep videos under 3 minutes for best engagement");
			suggestions.push("Add subtitles - many watch at work without sound");
			break;

		case "discord":
			warnings.push("Free users have 8MB file size limit");
			suggestions.push("Consider lower resolution for longer videos");
			suggestions.push("Nitro users can upload up to 100MB");
			break;
	}

	return { preset, warnings, suggestions };
}

export async function startExportJob({
	projectId,
	request,
	timeline,
	mediaFiles,
}: {
	projectId: string;
	request: ExportJobRequest;
	timeline: ClaudeTimeline;
	mediaFiles: MediaFile[];
}): Promise<{ jobId: string; status: ExportJobStatus["status"] }> {
	try {
		if (isTimelineEmpty({ timeline })) {
			throw new Error("Cannot export an empty timeline");
		}

		const activeJob = getActiveJobForProject({ projectId });
		if (activeJob) {
			throw new Error(
				`Export already in progress for project ${projectId} (job: ${activeJob.jobId})`
			);
		}

		const settings = resolveExportSettings({ request });
		const segments = collectExportSegments({ timeline, mediaFiles });

		if (segments.length === 0) {
			throw new Error("No video segments found to export");
		}

		const outputPath = request.outputPath?.trim()
			? request.outputPath.trim()
			: getDefaultOutputPath({
					projectId,
					format: settings.format,
				});

		const jobId = `export_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
		const now = Date.now();

		const newJob: ExportJobInternal = {
			jobId,
			projectId,
			status: EXPORT_JOB_STATUS.queued,
			progress: 0,
			startedAt: now,
			presetId: settings.presetId,
			settings,
			outputPath,
		};

		exportJobs.set(jobId, newJob);
		pruneOldJobs();

		logOperation({
			stage: 5,
			action: "export",
			details: `Queued export with preset ${settings.presetId}`,
			timestamp: now,
			projectId,
			metadata: {
				jobId,
				preset: settings.presetId,
			},
		});

		executeExportJob({
			jobId,
			projectId,
			settings,
			outputPath,
			segments,
		}).catch((error) => {
			claudeLog.error(
				HANDLER_NAME,
				`Unexpected export failure for ${jobId}:`,
				error
			);
		});

		return {
			jobId,
			status: EXPORT_JOB_STATUS.queued,
		};
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to start export job");
	}
}

export function getExportJobStatus(jobId: string): ExportJobStatus | null {
	try {
		return exportJobs.get(jobId) ?? null;
	} catch {
		return null;
	}
}

export function listExportJobs(projectId?: string): ExportJobStatus[] {
	try {
		const allJobs = [...exportJobs.values()];
		const filteredJobs = projectId
			? allJobs.filter((job) => job.projectId === projectId)
			: allJobs;

		return filteredJobs.sort((a, b) => b.startedAt - a.startedAt);
	} catch {
		return [];
	}
}

export function applyProgressEvent(payload: ProgressEventPayload): void {
	try {
		if (!payload.jobId || typeof payload.progress !== "number") {
			return;
		}

		updateJobProgress({
			jobId: payload.jobId,
			progress: payload.progress,
			currentFrame: payload.currentFrame,
			totalFrames: payload.totalFrames,
			fps: payload.fps,
			estimatedTimeRemaining: payload.estimatedTimeRemaining,
		});
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to apply progress event:", error);
	}
}

export function clearExportJobsForTests(): void {
	try {
		exportJobs.clear();
	} catch {
		// no-op
	}
}

/** Register Claude export IPC handlers for presets and recommendations. */
export function setupClaudeExportIPC(): void {
	claudeLog.info(HANDLER_NAME, "Setting up Export IPC handlers...");

	ipcMain.handle("claude:export:getPresets", async () => getExportPresets());

	ipcMain.handle(
		"claude:export:recommend",
		async (_event: IpcMainInvokeEvent, _projectId: string, target: string) =>
			getExportRecommendation(target)
	);

	ipcMain.on("ffmpeg-progress", (_event, data: ProgressEventPayload) => {
		applyProgressEvent(data);
	});

	claudeLog.info(HANDLER_NAME, "Export IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
	setupClaudeExportIPC,
	PRESETS,
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	getExportJobStatus,
	listExportJobs,
	applyProgressEvent,
	clearExportJobsForTests,
};
