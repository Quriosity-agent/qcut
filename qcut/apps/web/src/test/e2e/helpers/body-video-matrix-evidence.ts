import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
	matrixCanonicalAdjustments,
	type BodyVideoMatrixCase,
} from "./body-video-matrix-config";
import type { BodyOperationFrame } from "./body-video-operation-evidence";
import type { WorkerObservation } from "./body-video-worker-types";

interface ExecutionIdentity {
	profile: string;
	generation: string;
	[key: string]: unknown;
}

interface Route {
	network: string;
	backend: string;
}

export interface MatrixPipelineReport {
	passed: boolean;
	adjustments: ReturnType<typeof matrixCanonicalAdjustments>;
	outputDimensions: number[];
	inputRgbaSha256: string;
	outputRgbaSha256: string;
	nativeInputsUsed: boolean;
	nativeGeometryUsed: boolean;
	nativeFallbackUsed: boolean;
	stages: Array<{
		id: string;
		milliseconds: number;
		inputRgbaSha256: string;
		outputRgbaSha256: string;
		receipt: {
			frame?: number;
			timestampSeconds?: number;
			executionIdentity?: ExecutionIdentity;
			executionRoutes?: Route[];
		};
	}>;
}

export interface MatrixJournal {
	session: string;
	identity: ExecutionIdentity;
	frames: Array<{ frame: number; routes: Route[] }>;
}

export async function readBodyMatrixReports({
	observation,
}: {
	observation: WorkerObservation;
}) {
	return new Map(
		await Promise.all(
			observation.executions.map(async (entry) => {
				const bytes = await readFile(entry.file);
				assert.equal(
					createHash("sha256").update(bytes).digest("hex"),
					entry.sha256,
					"Worker report bytes changed"
				);
				return [
					entry.file,
					JSON.parse(bytes.toString("utf8")) as MatrixPipelineReport,
				] as const;
			})
		)
	);
}

export function verifyBodyMatrixCase({
	entry,
	original,
	exported,
	observation,
	reports,
	journals,
	fps,
}: {
	entry: BodyVideoMatrixCase;
	original: BodyOperationFrame[];
	exported: BodyOperationFrame[];
	observation: WorkerObservation;
	reports: Map<string, MatrixPipelineReport>;
	journals: MatrixJournal[];
	fps: number;
}) {
	assert.deepEqual(
		observation.evidenceErrors,
		[],
		"Observer reported invalid evidence"
	);
	assert.equal(exported.length, original.length);
	assert.ok(exported.length > 0);
	for (const [index, frame] of exported.entries()) {
		assert.equal(frame.frame, index);
		assert.equal(original[index].frame, index);
		assert.match(frame.rgbaSha256, /^[a-f0-9]{64}$/);
		assert.match(original[index].rgbaSha256, /^[a-f0-9]{64}$/);
	}
	const expected = matrixCanonicalAdjustments({ entry });
	const groups = new Map<
		string,
		Map<
			number,
			{
				frame: number;
				workerRequestId: string;
				outerRequestId: string;
				sourceTimestampSeconds: number;
				timelineTimestampSeconds: number;
				outerElapsedMs: number | null;
				workerElapsedMs: number | null;
				pipelineStageMilliseconds: number;
				routes: Route[];
			}
		>
	>();
	for (const execution of observation.executions) {
		const report = reports.get(execution.file);
		assert.ok(report, "Missing saved report");
		if (!isDeepStrictEqual(report.adjustments, expected)) continue;
		const frame = execution.frame;
		if (frame >= exported.length) continue;
		assert.equal(report.passed, true);
		assert.deepEqual(report.outputDimensions, [1080, 1920]);
		assert.equal(report.nativeInputsUsed, false);
		assert.equal(report.nativeGeometryUsed, false);
		assert.equal(report.nativeFallbackUsed, false);
		assert.deepEqual(
			report.stages.map(({ id }) => id),
			entry.manualTool ? ["manual-body", "smart-body"] : ["smart-body"]
		);
		let input = report.inputRgbaSha256;
		assert.equal(
			input,
			original[frame].rgbaSha256,
			"Worker input differs from original export"
		);
		for (const stage of report.stages) {
			assert.equal(stage.inputRgbaSha256, input, "Pipeline hash chain broke");
			input = stage.outputRgbaSha256;
		}
		assert.equal(report.outputRgbaSha256, input);
		assert.equal(
			report.outputRgbaSha256,
			exported[frame].rgbaSha256,
			"Worker output differs from export"
		);
		const body = report.stages.at(-1)!.receipt;
		const identity = body.executionIdentity;
		assert.ok(identity);
		assert.equal(identity.profile, "swing-coreml-v1");
		assert.match(identity.generation, /^[a-f0-9]{64}$/);
		assert.equal(execution.sequence?.executionGeneration, identity.generation);
		assert.equal(execution.sequence?.session, identity.generation);
		assert.equal(execution.generation, identity.generation);
		assert.equal(execution.profile, identity.profile);
		assert.equal(body.frame, frame);
		assert.deepEqual(body.executionRoutes, execution.routes);
		const journal = journals.find(
			({ session }) => session === identity.generation
		);
		assert.ok(journal, "Missing generation journal");
		assert.deepEqual(journal.identity, identity);
		assert.equal(journal.frames[frame]?.frame, frame);
		assert.deepEqual(journal.frames[frame].routes, execution.routes);
		const workers = observation.workerHistory.filter(
			({ id }) => id === execution.workerRequestId
		);
		assert.equal(workers.length, 1);
		const worker = workers[0];
		assert.equal(
			worker.association,
			"transport-id",
			"Explicit worker/IPC association required"
		);
		assert.equal(worker.outcome, "ok");
		const requests = observation.sequenceHistory.filter(
			({ requestId }) => requestId === worker.outerRequestId
		);
		assert.equal(requests.length, 1);
		const request = requests[0];
		assert.equal(request.frame, frame);
		assert.ok(
			Number.isFinite(request.sourceTimestampSeconds),
			"Decoded source PTS is required"
		);
		assert.equal(request.sourceTimestampSeconds, worker.sequence?.timestamp);
		assert.equal(request.sourceTimestampSeconds, body.timestampSeconds);
		const group = groups.get(identity.generation) ?? new Map();
		const prior = group.get(frame);
		if (prior)
			assert.equal(
				prior.sourceTimestampSeconds,
				request.sourceTimestampSeconds
			);
		group.set(frame, {
			frame,
			workerRequestId: worker.id,
			outerRequestId: request.requestId,
			sourceTimestampSeconds: request.sourceTimestampSeconds!,
			timelineTimestampSeconds: frame / fps,
			outerElapsedMs: request.elapsedMs ?? null,
			workerElapsedMs: worker.elapsedMs ?? null,
			pipelineStageMilliseconds: report.stages.reduce(
				(total, stage) => total + stage.milliseconds,
				0
			),
			routes: execution.routes,
		});
		groups.set(identity.generation, group);
	}
	const complete = [...groups].filter(
		([, rows]) =>
			rows.size === exported.length &&
			[...rows.values()].some(({ routes }) =>
				routes.some(({ backend }) => backend === "coreml")
			)
	);
	assert.ok(
		complete.length > 0,
		`${entry.id} lacks a complete CoreML generation bound to its export`
	);
	const [generation, rows] = complete[0];
	const frames = [...rows.values()].sort(
		(left, right) => left.frame - right.frame
	);
	const changedFrames = exported
		.filter((row, index) => row.rgbaSha256 !== original[index].rgbaSha256)
		.map(({ frame }) => frame);
	assert.ok(
		changedFrames.length > 0,
		`${entry.id} made no observable pixel change`
	);
	return {
		generation,
		verifiedCompleteGenerations: complete.map(([id]) => id),
		changedFrames,
		frames,
		repeatedOriginalFrames: original
			.filter(
				(row, index) =>
					index > 0 && row.rgbaSha256 === original[index - 1].rgbaSha256
			)
			.map(({ frame }) => ({
				frame,
				previousFrame: frame - 1,
				ownedOutputRepeated:
					exported[frame].rgbaSha256 === exported[frame - 1].rgbaSha256,
				sourceTimestampRepeated:
					frames[frame].sourceTimestampSeconds ===
					frames[frame - 1].sourceTimestampSeconds,
			})),
		timingScope:
			"Observed outer IPC and worker wall time include queue, validation and evidence overhead; pipeline stage times are reported separately, not inferred exclusive costs.",
	};
}
