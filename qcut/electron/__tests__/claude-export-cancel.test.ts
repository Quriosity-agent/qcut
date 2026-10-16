import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp"), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("electron-log", () => ({
	default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	cancelExportJob,
	clearExportJobsForTests,
	exportJobs,
	getExportJobStatus,
	updateJobProgress,
} from "../claude/handlers/claude-export-handler/job-manager.js";
import {
	EXPORT_JOB_STATUS,
	type ExportJobInternal,
} from "../claude/handlers/claude-export-handler/types.js";

function job(overrides: Partial<ExportJobInternal> = {}): ExportJobInternal {
	return {
		jobId: "job-1",
		projectId: "p",
		status: EXPORT_JOB_STATUS.exporting,
		progress: 0.4,
		startedAt: Date.now(),
		presetId: "youtube-1080p",
		engine: "native-cli",
		settings: {} as ExportJobInternal["settings"],
		outputPath: "/tmp/out.mp4",
		...overrides,
	};
}

/** Cancelling a native export: who can be stopped, and what the job says after. */
describe("cancelExportJob", () => {
	beforeEach(() => clearExportJobsForTests());

	it("marks a running job cancelled and fires its abort", () => {
		const abort = new AbortController();
		exportJobs.set("job-1", job({ abort }));
		const outcome = cancelExportJob({ jobId: "job-1" });
		expect(outcome.ok).toBe(true);
		expect(abort.signal.aborted).toBe(true);
		expect(getExportJobStatus("job-1")).toMatchObject({
			status: "cancelled",
			error: "Cancelled",
			completedAt: expect.any(Number),
		});
		// A progress report from the step being killed cannot revive it.
		updateJobProgress({ jobId: "job-1", progress: 0.5 });
		expect(getExportJobStatus("job-1")?.status).toBe("cancelled");
	});

	it("cancels a job that is still queued, so the engine stops before its first step", () => {
		exportJobs.set("job-1", job({ status: EXPORT_JOB_STATUS.queued }));
		expect(cancelExportJob({ jobId: "job-1" }).ok).toBe(true);
		expect(getExportJobStatus("job-1")?.status).toBe("cancelled");
	});

	it("leaves finished jobs, renderer exports and unknown ids alone", () => {
		exportJobs.set(
			"done",
			job({ jobId: "done", status: EXPORT_JOB_STATUS.completed })
		);
		exportJobs.set("muxer", job({ jobId: "muxer", engine: "renderer-muxer" }));
		expect(cancelExportJob({ jobId: "done" })).toMatchObject({
			ok: false,
			reason: "finished",
		});
		expect(getExportJobStatus("done")?.status).toBe("completed");
		expect(cancelExportJob({ jobId: "muxer" })).toMatchObject({
			ok: false,
			reason: "renderer",
		});
		expect(getExportJobStatus("muxer")?.status).toBe("exporting");
		expect(cancelExportJob({ jobId: "nope" })).toEqual({
			ok: false,
			reason: "not-found",
		});
	});
});
