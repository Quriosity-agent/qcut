import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { emitClaudeEvent } from "../claude/handlers/claude-events-handler";
import { renderTruePeakLimitedExport } from "../claude/handlers/claude-export-handler/export-audio-limiter";
import { executeExportJob } from "../claude/handlers/claude-export-handler/export-engine";
import {
	cancelExportJob,
	clearExportJobsForTests,
	exportJobs,
	getExportJobStatus,
} from "../claude/handlers/claude-export-handler/job-manager";
import type { ResolvedExportSettings } from "../claude/handlers/claude-export-handler/types";
import { getFFmpegPath } from "../ffmpeg/paths";
import type { AudioMixConfig } from "../ffmpeg/types";
import { CLAUDE_EDITOR_EVENT_CATEGORY } from "../types/claude-api";

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("../claude/handlers/claude-events-handler", () => ({
	emitClaudeEvent: vi.fn(),
}));
vi.mock("../claude/utils/logger", () => ({
	claudeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock(
	"../claude/handlers/claude-export-handler/export-audio-limiter",
	() => ({
		renderTruePeakLimitedExport: vi.fn(),
	})
);

const ffmpeg = getFFmpegPath();
const settings: ResolvedExportSettings = {
	engine: "native-cli",
	presetId: "custom",
	width: 16,
	height: 16,
	fps: 24,
	format: "mp4",
	codec: "libx264",
	bitrate: "128k",
	audioBitrate: 192,
	audioSampleRate: 48_000,
	audioChannels: 2,
};
const audioMixConfig: AudioMixConfig = {
	master: {
		id: "master",
		name: "Master",
		gainDb: 0,
		pan: 0,
		muted: false,
		solo: false,
		effects: {
			parametricEqualizer: {
				enabled: false,
				lowCutHz: 20,
				highCutHz: 20_000,
				bands: [],
			},
			compressor: {
				enabled: false,
				thresholdDb: -18,
				ratio: 3,
				attackMs: 10,
				releaseMs: 120,
				makeupGainDb: 0,
			},
			limiter: { enabled: true, ceilingDb: -1, releaseMs: 50 },
		},
	},
	buses: [],
	tracks: [],
};
let workDir = "";
let sourcePath = "";

function startNativeExport({ jobId }: { jobId: string }) {
	const outputPath = path.join(workDir, `${jobId}.mp4`);
	exportJobs.set(jobId, {
		jobId,
		projectId: "enforcement-project",
		settings,
		presetId: settings.presetId,
		engine: settings.engine,
		status: "queued",
		progress: 0,
		startedAt: Date.now(),
		outputPath,
	});
	const completion = executeExportJob({
		jobId,
		projectId: "enforcement-project",
		settings,
		outputPath,
		segments: [
			{
				elementId: "source",
				trackId: "video-track",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				sourceId: "source-media",
				startTime: 0,
				duration: 0.5,
				trimStart: 0,
				fitMode: "contain",
			},
		],
		audioMixConfig,
	});
	return { outputPath, completion };
}

function expectNoCompletedEvent() {
	expect(
		vi
			.mocked(emitClaudeEvent)
			.mock.calls.some(
				([event]) =>
					event.category === CLAUDE_EDITOR_EVENT_CATEGORY.exportCompleted
			)
	).toBe(false);
}

describe.skipIf(!existsSync(ffmpeg))(
	"native true-peak enforcement failures",
	() => {
		beforeAll(() => {
			workDir = mkdtempSync(path.join(tmpdir(), "qcut-enforcement-"));
			sourcePath = path.join(workDir, "source.mov");
			const generated = spawnSync(
				ffmpeg,
				[
					"-hide_banner",
					"-nostdin",
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=16x16:r=24:d=0.5",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=400:sample_rate=48000:duration=0.5",
					"-c:v",
					"libx264",
					"-c:a",
					"pcm_f32le",
					sourcePath,
				],
				{ encoding: "utf8", timeout: 30_000, windowsHide: true }
			);
			if (generated.error) throw generated.error;
			if (generated.status !== 0) throw new Error(generated.stderr);
		}, 30_000);

		beforeEach(() => {
			clearExportJobsForTests();
			vi.mocked(renderTruePeakLimitedExport).mockReset();
			vi.mocked(emitClaudeEvent).mockClear();
		});

		afterAll(() => {
			clearExportJobsForTests();
			if (workDir) rmSync(workDir, { recursive: true, force: true });
		});

		it("fails the export when final peak verification fails", async () => {
			vi.mocked(renderTruePeakLimitedExport).mockRejectedValueOnce(
				new Error("Final audio true peak could not be measured")
			);
			const { completion } = startNativeExport({ jobId: "meter-failed" });
			await completion;
			expect(renderTruePeakLimitedExport).toHaveBeenCalledOnce();
			const job = getExportJobStatus("meter-failed");
			expect(job).toMatchObject({
				status: "failed",
				error: expect.stringContaining("true peak could not be measured"),
			});
			expect(job?.audioValidation).toBeUndefined();
			expectNoCompletedEvent();
		}, 30_000);

		it.each([
			{ id: "new", existing: false, published: false },
			{ id: "preserve-existing", existing: true, published: false },
			{ id: "remove-published", existing: true, published: true },
		])("cancels enforcement safely: $id", async ({
			id,
			existing,
			published,
		}) => {
			const jobId = `cancel-enforcement-${id}`;
			const previousOutput = Buffer.from([0, 81, 67, 117, 116, 255]);
			if (existing) {
				writeFileSync(path.join(workDir, `${jobId}.mp4`), previousOutput);
			}
			vi.mocked(renderTruePeakLimitedExport).mockImplementationOnce(
				({ signal, outputPath, onPublished }) => {
					if (published) {
						writeFileSync(outputPath, "new verified export");
						expect(onPublished).toBeTypeOf("function");
						onPublished?.();
					}
					return new Promise((_resolve, reject) => {
						if (signal?.aborted) {
							reject(signal.reason);
							return;
						}
						signal?.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					});
				}
			);
			const { outputPath, completion } = startNativeExport({ jobId });
			try {
				await vi.waitFor(
					() => {
						expect(renderTruePeakLimitedExport).toHaveBeenCalledOnce();
					},
					{ timeout: 15_000 }
				);
				expect(getExportJobStatus(jobId)?.status).toBe("exporting");
				expect(getExportJobStatus(jobId)?.progress).toBeLessThan(1);
				if (existing && !published) {
					expect(readFileSync(outputPath)).toEqual(previousOutput);
				}
				expect(cancelExportJob({ jobId }).ok).toBe(true);
				await completion;
				expect(getExportJobStatus(jobId)).toMatchObject({
					status: "cancelled",
					error: "Cancelled",
				});
				expect(getExportJobStatus(jobId)?.audioValidation).toBeUndefined();
				if (existing && !published) {
					expect(readFileSync(outputPath)).toEqual(previousOutput);
				} else {
					expect(existsSync(outputPath)).toBe(false);
				}
				expectNoCompletedEvent();
			} finally {
				cancelExportJob({ jobId });
				await completion;
			}
		}, 30_000);
	}
);
