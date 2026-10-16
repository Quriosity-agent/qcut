/**
 * `editor timeline shot-split` and `editor timeline job-status`: split clips by
 * their shots through the editor's own action, as a polled job.
 *
 * @module electron/native-pipeline/editor/editor-handlers-shot-split
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

const ENGINES = ["auto", "jianying", "onnx", "ffmpeg"] as const;
const DEFAULT_WAIT_SECONDS = 600;
const DEFAULT_POLL_SECONDS = 2;

class FlagError extends Error {}

/**
 * Cut points from `--cuts`: a comma-separated list of seconds, or `@file`
 * holding a JSON array of seconds, an `analyze shots` result (`cut_points` /
 * `cutPoints`), or an `analyze scenes` result (`scenes[].timestamp`, where the
 * first boundary at 0 is the clip's own start).
 */
export function parseCutPoints({ text }: { text: string }): number[] {
	const trimmed = text.trim();
	let values: unknown;
	if (trimmed.startsWith("@")) {
		const raw = readFileSync(resolve(trimmed.slice(1)), "utf8");
		values = JSON.parse(raw);
	} else {
		values = trimmed
			.split(/[,\s]+/)
			.filter(Boolean)
			.map(Number);
	}
	const fromObject = (value: unknown): unknown => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return value;
		const record = value as Record<string, unknown>;
		if (Array.isArray(record.cut_points)) return record.cut_points;
		if (Array.isArray(record.cutPoints)) return record.cutPoints;
		if (Array.isArray(record.scenes)) {
			return (record.scenes as Array<{ timestamp?: unknown }>)
				.map((scene) => scene.timestamp)
				.filter((timestamp) => timestamp !== 0);
		}
		if (record.data !== undefined) return fromObject(record.data);
		return value;
	};
	values = fromObject(values);
	if (
		!Array.isArray(values) ||
		values.length === 0 ||
		values.some(
			(value) =>
				typeof value !== "number" || !Number.isFinite(value) || value < 0
		)
	) {
		throw new FlagError(
			"--cuts needs comma-separated seconds, or @file.json with an array of seconds or an analyze shots/scenes result"
		);
	}
	return values as number[];
}

interface TimelineJob {
	jobId: string;
	kind: string;
	status: "running" | "completed" | "failed";
	message?: string;
	result?: unknown;
	error?: string;
}

async function waitForTimelineJob({
	client,
	projectId,
	jobId,
	opts,
}: {
	client: EditorApiClient;
	projectId: string;
	jobId: string;
	opts: Pick<CLIRunOptions, "timeout" | "pollInterval">;
}): Promise<TimelineJob> {
	const budgetMs = (opts.timeout ?? DEFAULT_WAIT_SECONDS) * 1000;
	const pollSeconds = opts.pollInterval ?? DEFAULT_POLL_SECONDS;
	if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
		throw new FlagError("--poll-interval must be a positive number of seconds");
	}
	try {
		return await client.pollJob<TimelineJob>(
			`/api/claude/timeline/${projectId}/jobs/${encodeURIComponent(jobId)}`,
			{ interval: pollSeconds * 1000, timeout: budgetMs }
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Polling timed out")
		) {
			throw new FlagError(
				`Waited ${Math.round(budgetMs / 1000)} s; the shot split is still running in QCut (jobId=${jobId}). ` +
					`Follow it with: qcut editor timeline job-status --project-id ${projectId} --job-id ${jobId}`
			);
		}
		throw error;
	}
}

export async function timelineShotSplit(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	try {
		if (!opts.projectId)
			return { success: false, error: "Missing --project-id" };
		const elementId = opts.elementId?.trim();
		const trackId = opts.trackId?.trim();
		if (!elementId === !trackId) {
			throw new FlagError("Give exactly one of --element-id or --track-id");
		}
		const body: Record<string, unknown> = {};
		if (elementId) body.elementId = elementId;
		if (trackId) body.trackId = trackId;
		if (opts.engine !== undefined) {
			if (!ENGINES.some((engine) => engine === opts.engine)) {
				throw new FlagError(`--engine must be one of ${ENGINES.join(", ")}`);
			}
			body.engine = opts.engine;
		}
		if (opts.cuts !== undefined)
			body.cuts = parseCutPoints({ text: opts.cuts });
		if (opts.threshold !== undefined) {
			if (!Number.isFinite(opts.threshold) || opts.threshold < 0) {
				throw new FlagError("--threshold must be a non-negative number");
			}
			body.threshold = opts.threshold;
		}
		if (opts.minShot !== undefined) {
			if (!Number.isFinite(opts.minShot) || opts.minShot < 0) {
				throw new FlagError(
					"--min-shot must be a non-negative number of seconds"
				);
			}
			body.minShotSeconds = opts.minShot;
		}
		if (opts.dryRun) body.dryRun = true;

		const started = await client.post<{ jobId: string; status: string }>(
			`/api/claude/timeline/${opts.projectId}/shot-split`,
			body
		);
		if (opts.noWait) {
			return { success: true, data: { projectId: opts.projectId, ...started } };
		}
		const job = await waitForTimelineJob({
			client,
			projectId: opts.projectId,
			jobId: started.jobId,
			opts,
		});
		return {
			success: true,
			data: {
				projectId: opts.projectId,
				jobId: job.jobId,
				...(job.result as Record<string, unknown>),
			},
		};
	} catch (error) {
		if (error instanceof FlagError)
			return { success: false, error: error.message };
		throw error;
	}
}

export async function timelineJobStatus(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const jobId = opts.jobId?.trim();
	if (!jobId) return { success: false, error: "Missing --job-id" };
	const job = await client.get<TimelineJob>(
		`/api/claude/timeline/${opts.projectId}/jobs/${encodeURIComponent(jobId)}`
	);
	return { success: true, data: job };
}
