/**
 * Utility functions for Claude Export Handler.
 * @module electron/claude/handlers/claude-export-handler/utils
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { claudeLog } from "../../utils/logger.js";
import { defaultExportFileStem, freeExportPath } from "./export-file-name.js";
import { HANDLER_NAME, MAX_JOBS } from "./types.js";
import type { ExportJobInternal } from "./types.js";

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

/**
 * Where an export goes when the request names no file:
 * `Documents/QCut/Exports/<project name>-<YYYY-MM-DD-HHMMSS>.<format>`, the
 * project id standing in for a name that leaves nothing usable, and `-2`,
 * `-3`… added when that file is already there.
 */
export function getDefaultOutputPath({
	projectId,
	projectName,
	format,
}: {
	projectId: string;
	projectName?: string;
	format: string;
}): string {
	let documentsPath: string;
	try {
		documentsPath = app.getPath("documents");
	} catch {
		documentsPath = path.join(os.homedir(), "Documents");
	}
	try {
		return freeExportPath({
			directory: path.join(documentsPath, "QCut", "Exports"),
			stem: defaultExportFileStem({ projectName, projectId }),
			extension: format || "mp4",
			exists: fs.existsSync,
		});
	} catch {
		return path.join(
			documentsPath,
			"QCut",
			"Exports",
			`export-${Date.now()}.mp4`
		);
	}
}
