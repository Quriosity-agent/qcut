import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateResult,
} from "./beauty-lab/beauty-lab-candidate-contract.js";
import type { BeautyLabCandidateBackend } from "./beauty-lab/beauty-lab-candidate-provider.js";
import {
	liveDependenciesSchema,
	type LiveExpectedDependencies,
	verifyBeautyLabLiveDependencyInventory,
} from "./beauty-lab/beauty-lab-live-candidate-inventory.js";
import {
	liveCallbackSchema,
	verifyBeautyLabLiveReceipts,
} from "./beauty-lab/beauty-lab-live-candidate-receipts.js";
import {
	createSnapshot,
	type PinnedRoot,
	pinRoot,
	readJson,
	requireEvidence,
	type Snapshot,
} from "./beauty-lab-research-files.js";

export const LIVE_NATIVE_STAGES = [
	"detection",
	"geometry",
	"effect-rendering",
] as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const hostReceiptSchema = z
	.object({
		recipe: sha,
		sha256: sha,
		identity: z.string().regex(/^[A-F0-9]{40}$/),
		signature: z
			.object({
				identifier: z.literal("com.qcut.beauty-lab.live-host"),
				team: z.string().regex(/^[A-Za-z0-9]{10}$/),
				cdhash: z.string().regex(/^[a-fA-F0-9]{40}$/),
				requirement: z
					.string()
					.min(1)
					.max(8192)
					.regex(/\S/)
					.regex(/^[^\0]+$/),
			})
			.strict(),
	})
	.strict();
const hostIdentitySchema = hostReceiptSchema.extend({
	path: z.string().min(1).max(4096),
	reused: z.boolean(),
	permission_granted_by_launcher: z.literal(false),
	desktop_authorization: z.string().min(1).max(4096),
});
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
const coldFrameRequestSchema = z.object({
	id: z.literal("frame-00"),
	frame: z.literal(0),
	warmup: z.literal(false),
	timestamp: z.literal(0),
	timestamp_us: z.literal(0),
	output: z.string().min(1).max(4096),
});
const auditSchema = z.object({
	schema: z.literal("face-live-bridge-probe-v1"),
	passed: z.literal(true),
	completed: z.literal(true),
	scope: z.literal("single-frame-native-dependent-live-audit"),
	single_frame_audit: z.literal(true),
	cold_frame_audit: z.literal(true),
	warmup_request_count: z.literal(0),
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
	source_key: z.string().min(1).max(512),
	token_sha256: sha,
	host_identity: hostIdentitySchema,
	input_frames: z
		.array(z.object({ input_sha256: sha, parameters: z.unknown() }))
		.length(1),
	requests: z.object({
		baseline: z.array(coldFrameRequestSchema).length(1),
		live: z.array(coldFrameRequestSchema).length(1),
	}),
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
	dependencies: liveDependenciesSchema,
	callback_audit: liveCallbackSchema,
});

async function verifyLiveHostReceipt({
	hostDirectory,
	root,
	snapshot,
	audit,
}: {
	hostDirectory: string;
	root: PinnedRoot;
	snapshot: Snapshot;
	audit: z.infer<typeof auditSchema>;
}) {
	requireEvidence({
		condition: path.isAbsolute(hostDirectory),
		message: "absolute live host directory required",
	});
	const hostRoot = await pinRoot({ root: hostDirectory });
	const hostPath = path.join(hostDirectory, "live-host");
	const receiptPath = path.join(hostDirectory, "receipt.json");
	const host = audit.host_identity;
	const receiptHash = audit.dependencies.files[receiptPath];
	requireEvidence({
		condition:
			hostRoot.canonical === hostDirectory &&
			host.path === hostPath &&
			audit.dependencies.files[hostPath] === host.sha256 &&
			typeof receiptHash === "string",
		message: "live host path or dependency binding mismatch",
	});
	requireEvidence({
		condition:
			audit.artifacts["live-host.snapshot"]?.sha256 === host.sha256 &&
			audit.artifacts["live-host-receipt.json"]?.sha256 === receiptHash,
		message: "live host snapshot artifact binding mismatch",
	});
	// The shared cache may hold another build after Python releases its lease.
	const { value: receipt } = await readJson({
		snapshot,
		root,
		relativePath: "audit/live-host-receipt.json",
		maximum: 16 * 1024,
		expected: receiptHash,
		schema: hostReceiptSchema,
	});
	requireEvidence({
		condition: isDeepStrictEqual(receipt, {
			recipe: host.recipe,
			sha256: host.sha256,
			identity: host.identity,
			signature: host.signature,
		}),
		message: "live host signer or build receipt differs from audit",
	});
	await snapshot.read({
		root,
		relativePath: "audit/live-host.snapshot",
		maximum: 32 * 1024 ** 2,
		expected: host.sha256,
	});
	try {
		const { value: config } = await readJson({
			snapshot,
			root,
			relativePath: "audit/lldb-config.json",
			maximum: 128 * 1024,
			expected: sha.parse(audit.artifacts["lldb-config.json"]?.sha256),
			schema: z.object({
				host: z.literal(hostPath),
				token: z.string().min(16).max(512),
			}),
		});
		requireEvidence({
			condition:
				createHash("sha256").update(config.token).digest("hex") ===
				audit.token_sha256,
			message: "live LLDB token binding mismatch",
		});
	} catch {
		// JSON parse errors may echo the private launch token.
		throw new Error("Beauty Lab research: invalid live LLDB host binding");
	}
}

export async function readBeautyLabLiveCandidateResult({
	directory,
	hostDirectory,
	request,
	runtime,
	packagePath,
	models,
	lease,
	manifest,
	parameters,
	expectedDependencies,
}: {
	directory: string;
	hostDirectory: string;
	request: Parameters<BeautyLabCandidateBackend["render"]>[0];
	runtime: string;
	packagePath: string;
	models: string;
	lease: string;
	manifest: string;
	parameters: unknown;
	expectedDependencies: LiveExpectedDependencies;
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
	verifyBeautyLabLiveDependencyInventory({
		dependencies: audit.dependencies,
		expected: expectedDependencies,
	});
	requireEvidence({
		condition: (["baseline", "live"] as const).every(
			(phase) =>
				audit.requests[phase][0].output ===
				path.join(root.canonical, "audit", phase, "frame-00.rgba")
		),
		message: "cold-frame request output binding mismatch",
	});
	await verifyLiveHostReceipt({ hostDirectory, root, snapshot, audit });
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
	await verifyBeautyLabLiveReceipts({ root, snapshot, audit });
	const maximum = request.width * request.height * 4;
	const pixels = createSnapshot();
	const rgba = await pixels.read({
		root,
		relativePath: "candidate.rgba",
		maximum,
		expected: result.outputSha256,
	});
	const original = await pixels.read({
		root,
		relativePath: "input.rgba",
		maximum,
		expected: request.inputSha256,
	});
	requireEvidence({
		condition: original.length === maximum,
		message: "truncated input pixels",
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
	let changedRgbaPixels = 0;
	let changedRgbPixels = 0;
	for (let offset = 0; offset < maximum; offset += 4) {
		const rgbChanged =
			rgba[offset] !== original[offset] ||
			rgba[offset + 1] !== original[offset + 1] ||
			rgba[offset + 2] !== original[offset + 2];
		if (rgbChanged) changedRgbPixels += 1;
		if (rgbChanged || rgba[offset + 3] !== original[offset + 3])
			changedRgbaPixels += 1;
	}
	// Alpha-only changes do not establish beauty-effect activity.
	requireEvidence({
		condition: changedRgbPixels > 0,
		message: "original RGB pixels unchanged",
	});
	requireEvidence({
		condition: changedRgbaPixels === frame.original_difference.changed_pixels,
		message: "original RGBA change count differs from audit",
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
