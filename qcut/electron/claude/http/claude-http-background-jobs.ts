/**
 * Editor API work that outlives an HTTP request (a shot split of a whole
 * track, say) runs as a job: the route answers with a job id at once and the
 * client polls, so no request has to stay open for minutes.
 *
 * @module electron/claude/http/claude-http-background-jobs
 */

export interface BackgroundJob<T = unknown> {
	jobId: string;
	projectId: string;
	kind: string;
	status: "running" | "completed" | "failed";
	startedAt: number;
	completedAt?: number;
	/** What the job is doing, for a poller's progress line. */
	message?: string;
	result?: T;
	error?: string;
}

const MAX_JOBS = 50;
const jobs = new Map<string, BackgroundJob>();

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
export function startBackgroundJob<T>({
	projectId,
	kind,
	message,
	run,
}: {
	projectId: string;
	kind: string;
	message: string;
	run: () => Promise<T>;
}): BackgroundJob<T> {
	const job: BackgroundJob<T> = {
		jobId: `${kind.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${Math.random()
			.toString(36)
			.slice(2, 8)}`,
		projectId,
		kind,
		status: "running",
		startedAt: Date.now(),
		message,
	};
	jobs.set(job.jobId, job);
	prune();
	// Finished jobs are what prune can drop, so it runs again once this one
	// finishes.
	run().then(
		(result) => {
			job.status = "completed";
			job.completedAt = Date.now();
			job.result = result;
			job.message = undefined;
			prune();
		},
		(error) => {
			job.status = "failed";
			job.completedAt = Date.now();
			job.error = error instanceof Error ? error.message : String(error);
			job.message = undefined;
			prune();
		}
	);
	return job;
}

export function getBackgroundJob(jobId: string): BackgroundJob | null {
	return jobs.get(jobId) ?? null;
}

export function listBackgroundJobs(projectId: string): BackgroundJob[] {
	return [...jobs.values()]
		.filter((job) => job.projectId === projectId)
		.sort((left, right) => right.startedAt - left.startedAt);
}
