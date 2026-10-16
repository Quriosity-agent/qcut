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
	ClaudeMixLoudness,
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

function readLoudnessEngine(body: unknown): "native" | "browser" {
	const engine = (body as { engine?: unknown } | undefined)?.engine;
	if (engine === undefined || engine === "native") return "native";
	if (engine === "browser") return "browser";
	throw new HttpError(400, 'engine must be "native" or "browser"');
}

export type MeasureNativeLoudness = (args: {
	projectId: string;
}) => Promise<ClaudeMixLoudness>;

export function registerAudioMixRoutes({
	router,
	mutateAudioMix,
	measureNativeLoudness,
	onChanged,
	assertProjectOpen = async () => {},
}: {
	router: Router;
	mutateAudioMix?: MutateAudioMix;
	/** Renders the mix through the native export engine and measures it. */
	measureNativeLoudness?: MeasureNativeLoudness;
	/** Called after a change, with the project it changed. */
	onChanged: (change: { projectId: string }) => void;
	/** Refuses a project id other than the one the editor has open (409). */
	assertProjectOpen?: (projectId: string) => Promise<void>;
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
		await assertProjectOpen(req.params.projectId);
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
		await assertProjectOpen(req.params.projectId);
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
		await assertProjectOpen(req.params.projectId);
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
	// `engine` picks the rendering that is measured: "native" (default) runs
	// the FFmpeg export pipeline and so agrees with the exported file;
	// "browser" measures the renderer's graph, which the preview and the
	// muxer engine play.
	router.post("/api/claude/mix/:projectId/loudness", async (req) => {
		await assertProjectOpen(req.params.projectId);
		const projectId = req.params.projectId;
		const engine = readLoudnessEngine(req.body);
		if (engine === "native" && !measureNativeLoudness) {
			throw new HttpError(
				503,
				"The native export engine is not available here; measure with engine=browser"
			);
		}
		const job = startAudioMixJob({
			projectId,
			kind: "loudness",
			message:
				engine === "native"
					? "Exporting the mix through the native engine to measure it"
					: "Rendering the mix in the editor to measure it",
			run: async () => {
				if (engine === "native" && measureNativeLoudness) {
					return { loudness: await measureNativeLoudness({ projectId }) };
				}
				const { loudness } = await run(req, {
					action: "measure-loudness",
					projectId,
				});
				return {
					loudness: loudness ? { ...loudness, engine: "browser" } : loudness,
				};
			},
		});
		return { jobId: job.jobId, status: job.status, kind: job.kind, engine };
	});

	router.post("/api/claude/mix/:projectId/stems", async (req) => {
		await assertProjectOpen(req.params.projectId);
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
		await assertProjectOpen(req.params.projectId);
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
