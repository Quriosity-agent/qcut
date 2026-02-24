/**
 * Utility functions for Claude Export Handler.
 * @module electron/claude/handlers/claude-export-handler/utils
 */

import { app } from "electron";
import * as path from "node:path";
import { claudeLog } from "../../utils/logger.js";
import { HANDLER_NAME, MAX_JOBS } from "./types.js";
import type { ExportJobInternal } from "./types.js";

const NON_FILENAME_CHARS = /[^a-zA-Z0-9_-]+/g;
const TRIM_DASHES = /^-+|-+$/g;

export function sanitizeFileName({ input }: { input: string }): string {
	try {
		return input.replace(NON_FILENAME_CHARS, "-").replace(TRIM_DASHES, "");
	} catch {
		return "export";
	}
}

export function parseBitrateForKbps({ bitrate }: { bitrate: string }): string {
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

export function parseTimecodeToSeconds({
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

export function clampProgress({ value }: { value: number }): number {
	try {
		if (!Number.isFinite(value)) {
			return 0;
		}
		return Math.min(1, Math.max(0, value));
	} catch {
		return 0;
	}
}

export function pruneOldJobs(exportJobs: Map<string, ExportJobInternal>): void {
	try {
		if (exportJobs.size <= MAX_JOBS) {
			return;
		}
		// Only prune terminal jobs (completed/failed), never in-progress jobs
		const terminalJobs = [...exportJobs.entries()]
			.filter(
				([, job]) => job.status === "completed" || job.status === "failed"
			)
			.sort((a, b) => a[1].startedAt - b[1].startedAt);

		const removeCount = exportJobs.size - MAX_JOBS;
		const toRemove = Math.min(removeCount, terminalJobs.length);

		for (let i = 0; i < toRemove; i++) {
			exportJobs.delete(terminalJobs[i][0]);
		}
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to prune old export jobs:", error);
	}
}

export function getDefaultOutputPath({
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
