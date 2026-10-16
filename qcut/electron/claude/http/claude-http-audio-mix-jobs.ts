/**
 * Mixer renders that take minutes (loudness, stems) run as jobs: the route
 * answers with a job id at once and the CLI polls, so no HTTP request has to
 * stay open for the length of the render.
 *
 * @module electron/claude/http/claude-http-audio-mix-jobs
 */

import type {
	ClaudeMixLoudness,
	ClaudeMixStem,
} from "../../types/claude-audio-mix-api.js";

export type AudioMixJobKind = "loudness" | "stems";

export interface AudioMixJobResult {
	loudness?: ClaudeMixLoudness;
	stems?: ClaudeMixStem[];
	outputDir?: string;
}

export interface AudioMixJob {
	jobId: string;
	projectId: string;
	kind: AudioMixJobKind;
	status: "running" | "completed" | "failed";
	startedAt: number;
	completedAt?: number;
	/** What the job is doing, for a poller's progress line. */
	message?: string;
	result?: AudioMixJobResult;
	error?: string;
}

const MAX_JOBS = 50;
const jobs = new Map<string, AudioMixJob>();

function prune() {
	while (jobs.size > MAX_JOBS) {
		const oldest = [...jobs.values()]
			.filter((job) => job.status !== "running")
			.sort((left, right) => left.startedAt - right.startedAt)[0];
		if (!oldest) return;
		jobs.delete(oldest.jobId);
	}
}

/** Starts `run` and returns the job that tracks it. */
export function startAudioMixJob({
	projectId,
	kind,
	message,
	run,
}: {
	projectId: string;
	kind: AudioMixJobKind;
	message: string;
	run: () => Promise<AudioMixJobResult>;
}): AudioMixJob {
	const job: AudioMixJob = {
		jobId: `mix_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		projectId,
		kind,
		status: "running",
		startedAt: Date.now(),
		message,
	};
	jobs.set(job.jobId, job);
	prune();
	run().then(
		(result) => {
			job.status = "completed";
			job.completedAt = Date.now();
			job.result = result;
			job.message = undefined;
		},
		(error) => {
			job.status = "failed";
			job.completedAt = Date.now();
			job.error = error instanceof Error ? error.message : String(error);
			job.message = undefined;
		}
	);
	return job;
}

export function getAudioMixJob(jobId: string): AudioMixJob | null {
	return jobs.get(jobId) ?? null;
}

export function listAudioMixJobs(projectId: string): AudioMixJob[] {
	return [...jobs.values()]
		.filter((job) => job.projectId === projectId)
		.sort((left, right) => right.startedAt - left.startedAt);
}
