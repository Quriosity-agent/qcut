import { describe, expect, it } from "vitest";
import {
	getAudioMixJob,
	listAudioMixJobs,
	startAudioMixJob,
} from "../http/claude-http-audio-mix-jobs.js";

/** The registry keeps at most 50 jobs, counting the ones that finish later. */
describe("audio mix job registry", () => {
	it("drops finished jobs past the limit, even ones that finish after the limit was hit", async () => {
		const settle: Array<() => void> = [];
		const started = Array.from({ length: 55 }, () =>
			startAudioMixJob({
				projectId: "prune",
				kind: "loudness",
				message: "Rendering",
				run: () =>
					new Promise((resolve) => {
						settle.push(() => resolve({ loudness: {} as never }));
					}),
			})
		);
		// All 55 are running, so none can be pruned yet.
		expect(listAudioMixJobs("prune")).toHaveLength(55);

		for (const finish of settle) finish();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const kept = listAudioMixJobs("prune");
		expect(kept).toHaveLength(50);
		expect(kept.every((job) => job.status === "completed")).toBe(true);
		// The oldest five went, the newest stayed.
		for (const job of started.slice(0, 5)) {
			expect(getAudioMixJob(job.jobId)).toBeNull();
		}
		expect(getAudioMixJob(started[54].jobId)?.status).toBe("completed");
	});
});
