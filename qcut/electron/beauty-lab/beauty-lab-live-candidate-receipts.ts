import { createHash } from "node:crypto";
import { z } from "zod";
import {
	type PinnedRoot,
	type Snapshot,
	requireEvidence,
} from "../beauty-lab-research-files.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().safe().nonnegative();
const prediction = z.union([z.literal(0), z.literal(1)]);
const workerVersion = z.string().regex(/^dependency-core-v1:[a-f0-9]{64}$/);
export const liveCallbackSchema = z.object({
	backend_version: workerVersion,
	native_pid: integer.positive(),
	predictions: z.literal(2),
	conversions: z.literal(2),
	restorations: z.literal(2),
	bootstrap_unrendered_predictions: z.array(z.unknown()).length(0),
	clone_audit: z.object({
		audited_clones: z.literal(2),
		primary_faces_audited: integer.positive().max(60),
		native_update_calls: integer.max(60),
		native_analysis_bypassed: z.literal(false),
		audit_basis: z.literal("live-owned-conversion"),
	}),
});
const ownership = z
	.object({
		full_frame_rgba: z.literal("native"),
		detection: z.literal("native"),
		crop_caller_and_geometry: z.literal("native-live-observed"),
		sampling: z.literal("owned"),
		heads: z.literal("owned-onnx-cpu"),
		temporal: z.literal("owned"),
		acceptance_and_reset: z.literal("native"),
		renderer: z.literal("native-owned-clone-required"),
		native_analysis_bypassed: z.literal(false),
		live_parity_verified: z.literal(false),
		product_backend_registered: z.literal(false),
	})
	.strict();
const workerRow = z.object({
	ok: z.literal(true),
	token: z.string().min(16).max(512),
	pid: integer.positive(),
	prediction,
	timestamp_us: z.literal(0),
	stage_ownership: ownership,
	result: z.object({
		schema: z.literal("face-live-candidate-result-v1"),
		source: z.literal("dependency-fed-research-inference"),
		backend_version: workerVersion,
		source_key: z.string().min(1).max(512),
		prediction,
		frame_number: prediction,
		timestamp_us: z.literal(0),
		algorithm_rgba_sha256: sha,
		dependency_sha256: sha,
		algorithm_width: integer.positive().max(4096),
		algorithm_height: integer.positive().max(4096),
		faces: z
			.array(
				z
					.object({
						id: integer.max(2 ** 31 - 1),
						points: z
							.array(
								z.tuple([
									z.number().finite().min(0).max(1),
									z.number().finite().min(0).max(1),
								])
							)
							.length(106),
					})
					.strict()
			)
			.max(1),
		native_final_point_input_used: z.literal(false),
		captured_tensor_input_used: z.literal(false),
		native_analysis_bypassed: z.literal(false),
		product_parity_verified: z.literal(false),
		candidate_parity_verified: z.literal(false),
		arbitrary_frame_backend_connected: z.literal(false),
	}),
});
const received = z.object({
	event: z.literal("live_candidate_received"),
	prediction,
	timestamp_us: z.literal(0),
});
const converted = z.object({
	event: z.literal("live_owned_conversion"),
	prediction,
	timestamp_us: z.literal(0),
	binding_id: integer.positive(),
	graph_id: integer.positive(),
	faces: integer.max(1),
	conversion_scope: z.literal("native-seek"),
	source_points_unchanged: z.literal(true),
	candidate_source: z.literal("fresh-worker-inference"),
	native_analysis_bypassed: z.literal(false),
});
const restored = z.object({
	event: z.literal("live_owned_restored"),
	prediction,
	timestamp_us: z.literal(0),
	binding_id: integer.positive(),
	graph_id: integer.positive(),
	gpu_complete: z.literal(true),
	original_restored: z.literal(true),
});
const clone = z.object({
	event: z.literal("face_clone_audit"),
	distinct_buffer: z.literal(true),
	initial_refcount: z.literal(0),
	owned_refcount: z.literal(1),
	source_refcount: integer.positive(),
	vector_counts: z.array(integer.max(10)).length(6),
	primary_metadata_equal: z.literal(true),
	primary_points_isolated: z.literal(true),
	native_analysis_bypassed: z.literal(false),
});

async function readRows({
	root,
	snapshot,
	relativePath,
	hash,
}: {
	root: PinnedRoot;
	snapshot: Snapshot;
	relativePath: string;
	hash: string;
}) {
	const bytes = await snapshot.read({
		root,
		relativePath,
		maximum: 4 * 1024 ** 2,
		expected: sha.parse(hash),
	});
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	requireEvidence({
		condition: text.endsWith("\n"),
		message: "complete receipt JSONL required",
	});
	const lines = text.slice(0, -1).split("\n");
	requireEvidence({
		condition:
			lines.length > 0 &&
			lines.length <= 4096 &&
			lines.every(
				(line) => line.length > 0 && Buffer.byteLength(line) <= 128 * 1024
			),
		message: "bounded receipt JSONL required",
	});
	return lines.map((line) => z.record(z.unknown()).parse(JSON.parse(line)));
}

export async function verifyBeautyLabLiveReceipts({
	root,
	snapshot,
	audit,
}: {
	root: PinnedRoot;
	snapshot: Snapshot;
	audit: {
		artifacts: Record<string, { sha256: string }>;
		callback_audit: z.infer<typeof liveCallbackSchema>;
		source_key: string;
		token_sha256: string;
	};
}) {
	try {
		const workers = (
			await readRows({
				root,
				snapshot,
				relativePath: "audit/live/worker.jsonl",
				hash: audit.artifacts["live/worker.jsonl"]?.sha256,
			})
		).map((row) => workerRow.parse(row));
		requireEvidence({
			condition:
				workers.length === 2 &&
				workers.every(
					(row, index) =>
						row.prediction === index &&
						row.result.prediction === index &&
						row.result.frame_number === index &&
						row.pid === audit.callback_audit.native_pid &&
						row.result.source_key === audit.source_key &&
						row.result.backend_version ===
							audit.callback_audit.backend_version &&
						createHash("sha256").update(row.token).digest("hex") ===
							audit.token_sha256
				),
			message: "worker session, ownership or prediction identity differs",
		});
		const records = await readRows({
			root,
			snapshot,
			relativePath: "audit/live/records.jsonl",
			hash: audit.artifacts["live/records.jsonl"]?.sha256,
		});
		let index = 0;
		let phase: "receive" | "convert" | "restore" = "receive";
		let pending: z.infer<typeof converted> | undefined;
		let clones = 0;
		let primaryFaces = 0;
		let updates = 0;
		const cloneCounts = [0, 0];
		const bindings = new Set<number>();
		for (const record of records) {
			switch (record.event) {
				case "live_candidate_received": {
					const row = received.parse(record);
					requireEvidence({
						condition:
							index < 2 && phase === "receive" && row.prediction === index,
						message: "cold receipt order differs",
					});
					phase = "convert";
					break;
				}
				case "live_owned_conversion": {
					const row = converted.parse(record);
					requireEvidence({
						condition:
							index < 2 &&
							phase === "convert" &&
							row.prediction === index &&
							row.faces === workers[index].result.faces.length &&
							!bindings.has(row.binding_id),
						message: "cold conversion association differs",
					});
					bindings.add(row.binding_id);
					pending = row;
					phase = "restore";
					break;
				}
				case "live_owned_restored": {
					const row = restored.parse(record);
					requireEvidence({
						condition:
							phase === "restore" &&
							row.prediction === index &&
							row.binding_id === pending?.binding_id &&
							row.graph_id === pending?.graph_id &&
							cloneCounts[index] === 1,
						message: "cold restoration association differs",
					});
					index += 1;
					phase = "receive";
					pending = undefined;
					break;
				}
				case "face_clone_audit": {
					const row = clone.parse(record);
					requireEvidence({
						condition:
							index < 2 &&
							phase !== "receive" &&
							cloneCounts[index] === 0 &&
							row.vector_counts[0] === workers[index].result.faces.length,
						message: "unsupported or unassociated face clone",
					});
					cloneCounts[index] += 1;
					clones += 1;
					primaryFaces += row.vector_counts[0];
					break;
				}
				case "algorithm_update": {
					const row = z
						.object({
							native_update_call: integer.positive(),
							timestamp_us: z.literal(0),
							eye_shift: z.literal(0),
							external_points: z.literal(false),
						})
						.parse(record);
					updates += 1;
					requireEvidence({
						condition: row.native_update_call === updates,
						message: "native update sequence differs",
					});
					break;
				}
				case "live_cold_setup":
					z.object({
						algorithms: integer.positive().max(32),
						first_prediction: z.literal(0),
						inspection_performed: z.literal(false),
						renderer_consumption: z.literal(false),
					}).parse(record);
					break;
				case "live_inspection_conversion":
					z.object({
						prediction,
						timestamp_us: z.literal(0),
						candidate_injected: z.literal(false),
						renderer_consumption: z.literal(false),
					}).parse(record);
					requireEvidence({
						condition: phase === "receive",
						message: "inspection during unfinished consumer handoff",
					});
					break;
				default:
					requireEvidence({
						condition:
							record.event === undefined &&
							record.renderer_consumption !== true,
						message: "unsupported native consumer event",
					});
			}
		}
		const summary = audit.callback_audit.clone_audit;
		requireEvidence({
			condition:
				index === 2 &&
				phase === "receive" &&
				!pending &&
				clones === summary.audited_clones &&
				updates === summary.native_update_calls &&
				primaryFaces === summary.primary_faces_audited &&
				primaryFaces > 0,
			message: "incomplete cold consumer or clone coverage",
		});
	} catch {
		// Parsing errors can include the worker's private session token.
		throw new Error(
			"Beauty Lab research: invalid cold worker/consumer receipts"
		);
	}
}
