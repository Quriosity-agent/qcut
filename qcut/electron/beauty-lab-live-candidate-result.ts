import { createHash } from "node:crypto";
import { z } from "zod";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateResult,
} from "./beauty-lab-candidate-contract.js";
import type { BeautyLabCandidateBackend } from "./beauty-lab-candidate-provider.js";
import {
	createSnapshot,
	pinRoot,
	readJson,
	requireEvidence,
} from "./beauty-lab-research-files.js";

export const LIVE_NATIVE_STAGES = [
	"detection",
	"geometry",
	"effect-rendering",
] as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const workerVersion = z.string().regex(/^dependency-core-v1:[a-f0-9]{64}$/);
const metric = z.union([
	z
		.object({
			id: z.enum(BEAUTY_LAB_CANDIDATE_STAGES),
			durationMs: z.number().finite().nonnegative(),
		})
		.strict(),
	z
		.object({
			id: z.enum(LIVE_NATIVE_STAGES),
			durationMs: z.null(),
			unavailableReason: z.literal("native-stage-not-instrumented"),
		})
		.strict(),
]);
const resultSchema = z
	.object({
		protocol: z.literal(BEAUTY_LAB_CANDIDATE_PROTOCOL),
		source: z.literal("live-candidate"),
		backendId: z.literal(BEAUTY_LAB_CANDIDATE_BACKEND),
		backendVersion: z.string(),
		requestId: z.string(),
		requestFingerprint: sha,
		inputSha256: sha,
		sourceKey: z.string(),
		frameNumber: z.number().int().nonnegative(),
		timestampSeconds: z.number().finite().nonnegative(),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		nativeDependencies: z.array(z.enum(LIVE_NATIVE_STAGES)).length(3),
		stageMetrics: z.array(metric).length(BEAUTY_LAB_CANDIDATE_STAGES.length),
		outputSha256: sha,
		scope: z.literal("audited-single-static-frame"),
		temporal_sequence_acceptance: z.literal(false),
		full_frame_preprocessing: z.literal("native"),
		native_baseline_used_as_output: z.literal(false),
		audit: z.literal("audit/report.json"),
		timingScope: z.literal("cumulative-owned-worker-including-warmup"),
	})
	.strict();
const auditSchema = z.object({
	schema: z.literal("face-live-bridge-probe-v1"),
	passed: z.literal(true),
	completed: z.literal(true),
	scope: z.literal("single-frame-native-dependent-live-audit"),
	single_frame_audit: z.literal(true),
	temporal_sequence_acceptance: z.literal(false),
	dependencies_unchanged: z.literal(true),
	native_execution_performed: z.literal(true),
	live_checks_completed: z.literal(true),
	live_callback_handoff_verified: z.literal(true),
	render_tolerance: z.literal(0),
	native_analysis_bypassed: z.literal(false),
	captured_tensor_input_used: z.literal(false),
	native_final_point_input_used: z.literal(false),
	failures: z.array(z.unknown()).length(0),
	cleanup: z.object({
		completed: z.literal(true),
		failures: z.array(z.unknown()).length(0),
	}),
	native_launch_lease: z.string(),
	runtime: z.string(),
	package: z.string(),
	root: z.string(),
	width: z.number(),
	height: z.number(),
	manifest: z.string(),
	input_frames: z
		.array(z.object({ input_sha256: sha, parameters: z.unknown() }))
		.length(1),
	frames: z
		.array(
			z.object({
				frame: z.literal(0),
				equal: z.literal(true),
				changed_pixels: z.literal(0),
				max_delta: z.literal(0),
				sha256: sha,
				native_sha256: sha,
				original_difference: z.object({
					changed_pixels: z.number().int().positive(),
				}),
			})
		)
		.length(1),
	artifacts: z.record(z.object({ sha256: sha }).passthrough()),
	dependencies: z
		.object({
			files: z.record(sha),
			libraries: z.record(z.unknown()),
			trees: z.array(z.unknown()).min(1).max(16),
		})
		.passthrough(),
	callback_audit: z.object({
		backend_version: workerVersion,
		predictions: z.number().int().min(1).max(60),
	}),
});

export async function readBeautyLabLiveCandidateResult({
	directory,
	request,
	runtime,
	packagePath,
	models,
	lease,
	manifest,
	parameters,
}: {
	directory: string;
	request: Parameters<BeautyLabCandidateBackend["render"]>[0];
	runtime: string;
	packagePath: string;
	models: string;
	lease: string;
	manifest: string;
	parameters: unknown;
}): Promise<BeautyLabCandidateResult> {
	const root = await pinRoot({ root: directory });
	const snapshot = createSnapshot();
	const { value: result } = await readJson({
		snapshot,
		root,
		relativePath: "result.json",
		maximum: 128 * 1024,
		schema: resultSchema,
	});
	const { value: audit, hash: auditSha256 } = await readJson({
		snapshot,
		root,
		relativePath: "audit/report.json",
		maximum: 8 * 1024 ** 2,
		schema: auditSchema,
	});
	const identityKeys = [
		"requestId",
		"requestFingerprint",
		"inputSha256",
		"sourceKey",
		"frameNumber",
		"timestampSeconds",
		"width",
		"height",
		"backendVersion",
	] as const;
	requireEvidence({
		condition: identityKeys.every((key) => result[key] === request[key]),
		message: "live result request identity mismatch",
	});
	requireEvidence({
		condition:
			audit.native_launch_lease === lease &&
			audit.runtime === runtime &&
			audit.package === packagePath &&
			audit.root === models &&
			audit.manifest === manifest &&
			audit.width === request.width &&
			audit.height === request.height &&
			audit.input_frames[0].input_sha256 === request.inputSha256 &&
			JSON.stringify(audit.input_frames[0].parameters) ===
				JSON.stringify(parameters),
		message: "fresh baseline audit request mismatch",
	});
	requireEvidence({
		condition:
			new Set(result.nativeDependencies).size === 3 &&
			new Set(result.stageMetrics.map(({ id }) => id)).size ===
				BEAUTY_LAB_CANDIDATE_STAGES.length &&
			result.stageMetrics.every(
				(row) =>
					(row.durationMs === null) ===
					LIVE_NATIVE_STAGES.some((id) => id === row.id)
			),
		message: "owned measurements and explicit native timing gaps required",
	});
	const frame = audit.frames[0];
	requireEvidence({
		condition:
			frame.sha256 === result.outputSha256 &&
			frame.native_sha256 === result.outputSha256 &&
			audit.artifacts["live/frame-00.rgba"]?.sha256 === result.outputSha256 &&
			audit.artifacts["baseline/frame-00.rgba"]?.sha256 === result.outputSha256,
		message: "fresh native/live artifact hashes disagree",
	});
	const workerLogSha256 = audit.artifacts["live/worker.jsonl"]?.sha256;
	requireEvidence({
		condition: typeof workerLogSha256 === "string",
		message: "worker log digest required",
	});
	const workerLog = await snapshot.read({
		root,
		relativePath: "audit/live/worker.jsonl",
		maximum: 8 * 1024 ** 2,
		expected: workerLogSha256,
	});
	const rows = workerLog.toString("utf8").trim().split("\n");
	requireEvidence({
		condition: rows.length === audit.callback_audit.predictions,
		message: "worker receipt count mismatch",
	});
	const workerRow = z.object({
		ok: z.literal(true),
		result: z.object({ backend_version: workerVersion }),
	});
	requireEvidence({
		condition: rows.every(
			(row) =>
				workerRow.parse(JSON.parse(row)).result.backend_version ===
				audit.callback_audit.backend_version
		),
		message: "worker identity differs from audit",
	});
	const maximum = request.width * request.height * 4;
	const pixels = createSnapshot();
	const rgba = await pixels.read({
		root,
		relativePath: "candidate.rgba",
		maximum,
		expected: result.outputSha256,
	});
	await pixels.read({
		root,
		relativePath: "input.rgba",
		maximum,
		expected: request.inputSha256,
	});
	await pixels.read({
		root,
		relativePath: "audit/live/frame-00.rgba",
		maximum,
		expected: result.outputSha256,
	});
	await pixels.read({
		root,
		relativePath: "audit/baseline/frame-00.rgba",
		maximum,
		expected: result.outputSha256,
	});
	requireEvidence({
		condition: rgba.length === maximum,
		message: "truncated candidate pixels",
	});
	await snapshot.verify();
	await pixels.verify();
	return {
		...result,
		rgba: new Uint8Array(rgba),
		provenance: {
			auditSha256,
			dependenciesSha256: createHash("sha256")
				.update(JSON.stringify(audit.dependencies))
				.digest("hex"),
			workerLogSha256: workerLogSha256 as string,
			workerBackendVersion: audit.callback_audit.backend_version,
		},
	};
}
