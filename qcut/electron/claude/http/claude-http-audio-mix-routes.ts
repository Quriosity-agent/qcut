/**
 * Mixer routes: read the whole mix, change a track's mixer settings, and
 * create, change or remove buses (the master is the bus "master").
 *
 *   GET    /api/claude/mix/:projectId
 *   PATCH  /api/claude/mix/:projectId/tracks/:trackId
 *   POST   /api/claude/mix/:projectId/buses
 *   PATCH  /api/claude/mix/:projectId/buses/:busId
 *   DELETE /api/claude/mix/:projectId/buses/:busId
 *   POST   /api/claude/mix/:projectId/loudness   starts a job: render, then measure
 *   POST   /api/claude/mix/:projectId/stems      { outputDir, fileNamePrefix? }: starts a job, one WAV per bus
 *   GET    /api/claude/mix/:projectId/jobs/:jobId   the job's status and result
 *   GET    /api/claude/mix/:projectId/jobs
 *
 * Each answers with the mix read back from the editor.
 *
 * @module electron/claude/http/claude-http-audio-mix-routes
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
} from "../../types/claude-audio-mix-api.js";
import type { ParsedRequest, Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";
import {
	readBusPatch,
	readNewBusId,
	readTrackAudioPatch,
} from "./audio-mix-request.js";
import {
	getAudioMixJob,
	listAudioMixJobs,
	startAudioMixJob,
} from "./claude-http-audio-mix-jobs.js";
import { getRequestCorrelationId } from "./claude-http-meta-routes.js";

export type MutateAudioMix = (
	request: ClaudeAudioMixRequest,
	correlationId?: string
) => Promise<ClaudeAudioMixResponse>;

const STATUS_BY_REASON: Record<
	NonNullable<ClaudeAudioMixResponse["reason"]>,
	number
> = {
	"not-open": 409,
	"not-found": 404,
	invalid: 400,
};

export function registerAudioMixRoutes({
	router,
	mutateAudioMix,
	onChanged,
}: {
	router: Router;
	mutateAudioMix?: MutateAudioMix;
	/** Called after a change, with the project it changed. */
	onChanged: (change: { projectId: string }) => void;
}): void {
	async function run(
		req: ParsedRequest,
		request: ClaudeAudioMixRequest
	): Promise<ClaudeAudioMixResponse> {
		if (!mutateAudioMix) {
			throw new HttpError(503, "The mixer is not available in this editor");
		}
		const result = await mutateAudioMix(
			request,
			getRequestCorrelationId({ req })
		);
		if (!result.success) {
			throw new HttpError(
				STATUS_BY_REASON[result.reason ?? "invalid"],
				result.error ?? "The mixer change failed"
			);
		}
		if (
			request.action !== "get" &&
			request.action !== "measure-loudness" &&
			request.action !== "render-stems"
		) {
			onChanged({ projectId: request.projectId });
		}
		return result;
	}

	router.get("/api/claude/mix/:projectId", async (req) => {
		const { mix } = await run(req, {
			action: "get",
			projectId: req.params.projectId,
		});
		return mix;
	});

	router.patch("/api/claude/mix/:projectId/tracks/:trackId", async (req) => {
		const patch = readTrackAudioPatch(req.body);
		const { mix } = await run(req, {
			action: "set-track",
			projectId: req.params.projectId,
			trackId: req.params.trackId,
			patch,
		});
		return {
			track: mix?.tracks.find((track) => track.trackId === req.params.trackId),
			mix,
		};
	});

	router.post("/api/claude/mix/:projectId/buses", async (req) => {
		const busId = readNewBusId(req.body);
		const bus = readBusPatch(req.body, { creating: true });
		const result = await run(req, {
			action: "create-bus",
			projectId: req.params.projectId,
			...(busId ? { busId } : {}),
			bus: { ...bus, name: bus.name as string },
		});
		return {
			busId: result.busId,
			bus: result.mix?.buses.find((candidate) => candidate.id === result.busId),
			mix: result.mix,
		};
	});

	router.patch("/api/claude/mix/:projectId/buses/:busId", async (req) => {
		const patch = readBusPatch(req.body);
		const { mix } = await run(req, {
			action: "update-bus",
			projectId: req.params.projectId,
			busId: req.params.busId,
			patch,
		});
		return {
			bus:
				req.params.busId === mix?.master.id
					? mix.master
					: mix?.buses.find((bus) => bus.id === req.params.busId),
			mix,
		};
	});

	// Loudness and stems render the whole mix, minutes for a long programme,
	// so they run as jobs: the answer is a job id, polled at .../jobs/:jobId.
	router.post("/api/claude/mix/:projectId/loudness", async (req) => {
		const projectId = req.params.projectId;
		const job = startAudioMixJob({
			projectId,
			kind: "loudness",
			message: "Rendering the mix to measure it",
			run: async () => {
				const { loudness } = await run(req, {
					action: "measure-loudness",
					projectId,
				});
				return { loudness };
			},
		});
		return { jobId: job.jobId, status: job.status, kind: job.kind };
	});

	router.post("/api/claude/mix/:projectId/stems", async (req) => {
		const projectId = req.params.projectId;
		const outputDir =
			typeof req.body?.outputDir === "string" ? req.body.outputDir.trim() : "";
		if (!outputDir || !path.isAbsolute(outputDir)) {
			throw new HttpError(400, "outputDir must be an absolute folder path");
		}
		const fileNamePrefix =
			typeof req.body?.fileNamePrefix === "string"
				? req.body.fileNamePrefix
				: "";
		if (/[\\/]/.test(fileNamePrefix)) {
			throw new HttpError(400, "fileNamePrefix cannot contain a folder");
		}
		await fs.promises.mkdir(outputDir, { recursive: true });
		const job = startAudioMixJob({
			projectId,
			kind: "stems",
			message: `Writing one WAV per bus into ${outputDir}`,
			run: async () => {
				const { stems } = await run(req, {
					action: "render-stems",
					projectId,
					outputDir,
					fileNamePrefix,
				});
				return { outputDir, stems: stems ?? [] };
			},
		});
		return { jobId: job.jobId, status: job.status, kind: job.kind, outputDir };
	});

	router.get("/api/claude/mix/:projectId/jobs/:jobId", async (req) => {
		const job = getAudioMixJob(req.params.jobId);
		if (!job || job.projectId !== req.params.projectId) {
			throw new HttpError(404, `Mix job not found: ${req.params.jobId}`);
		}
		return job;
	});

	router.get("/api/claude/mix/:projectId/jobs", async (req) => ({
		jobs: listAudioMixJobs(req.params.projectId),
	}));

	router.delete("/api/claude/mix/:projectId/buses/:busId", async (req) => {
		const result = await run(req, {
			action: "remove-bus",
			projectId: req.params.projectId,
			busId: req.params.busId,
		});
		return {
			removed: req.params.busId,
			reroutedTrackIds: result.reroutedTrackIds ?? [],
			mix: result.mix,
		};
	});
}
