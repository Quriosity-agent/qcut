import { z } from "zod";
import { HEIGHT, WIDTH } from "./beauty-lab-research-files.js";

export const FRAME_COUNT = 7;
export const sha = z.string().regex(/^[a-f0-9]{64}$/);
const empty = z.array(z.unknown()).length(0);
const passed = { passed: z.literal(true), failures: empty };
const completed = { ...passed, completed: z.literal(true) };
const dimensions = { width: z.literal(WIDTH), height: z.literal(HEIGHT) };
const sourceHashes = z.record(sha).refine((value) => {
	const count = Object.keys(value).length;
	return count > 0 && count <= 128;
});
const parameters = z
	.object({
		face_adjust_eye: z
			.array(
				z
					.object({
						id: z.literal(-1),
						intensity: z.number().finite().min(0).max(1),
					})
					.strict()
			)
			.length(1),
	})
	.strict();
const frames = z
	.array(
		z.object({
			image_sha256: sha,
			input_rgba_sha256: sha,
			timestamp: z.number().finite().min(0).max(60),
			parameters,
		})
	)
	.length(FRAME_COUNT);
const comparisons = z
	.array(
		z.object({
			index: z.number().int(),
			equal: z.literal(true),
			changed_pixels: z.literal(0),
			max_delta: z.literal(0),
			baseline_sha256: sha,
			sha256: sha,
		})
	)
	.length(FRAME_COUNT)
	.refine((rows) => rows.every((row, index) => row.index === index));
const nativePolicy = {
	owned_initialization_used: z.literal(true),
	owned_temporal_smoothing_used: z.literal(true),
	native_smoothing_seed_predictions: empty,
	native_smoothing_seed_required: z.literal(false),
	native_smoothing_initialization_required: z.literal(true),
	native_160_sampling_input_required: z.literal(true),
	independent_160_sampling_input_used: z.literal(false),
};
export const campaignSchema = z.object({
	...completed,
	pipeline_parity: z.literal(true),
	product_parity_verified: z.literal(false),
	native_analysis_required: z.literal(true),
	profile: z.object({
		manifest_frames: z.literal(7),
		predictions: z.literal(26),
		conversions: z.literal(24),
	}),
	campaigns: z
		.array(
			z.object({
				index: z.number().int().min(0).max(1),
				passed: z.literal(true),
				completed: z.literal(true),
				manifest_sha256: sha,
				stages: z
					.array(
						z.object({
							passed: z.literal(true),
							completed: z.literal(true),
							name: z.enum(["probe", "replay", "render", "audit"]),
							status: z.literal("passed"),
							returncode: z.literal(0),
							report_sha256: sha,
						})
					)
					.length(4),
			})
		)
		.min(1)
		.max(2),
});
export const probeSchema = z.object({
	...passed,
	...dimensions,
	native_analysis_bypassed: z.literal(false),
	completed: z.literal(true).optional(),
	predictions: z.literal(26),
	frames,
	comparisons,
	source_sha256: sourceHashes,
});
export const replaySchema = z.object({
	...completed,
	...nativePolicy,
	diagnostic_only: z.literal(false),
	geometry_exact: z.literal(true),
	native_analysis_bypassed: z.literal(false),
	manifest_frames: z.literal(7),
	capture_sha256: sha,
	replay_sha256: sha,
	source_sha256: sourceHashes,
	cases: z
		.array(z.object({ prediction: z.number().int() }))
		.length(26)
		.refine((rows) => rows.every((row, index) => row.prediction === index)),
});
export const renderSchema = z.object({
	...completed,
	...dimensions,
	diagnostic_only: z.literal(false),
	native_analysis_bypassed: z.literal(false),
	product_parity_verified: z.literal(false),
	external_replay_verified: z.literal(true),
	pixel_parity_verified: z.literal(true),
	frames,
	comparisons,
	capture_sha256: sha,
	replay_sha256: sha,
	manifest_sha256: sha,
	source_sha256: sourceHashes,
	out: z.string().min(1).max(4096),
	fixture_sha256: z.record(sha),
});
export const auditSchema = z.object({
	...completed,
	...nativePolicy,
	pipeline_parity: z.literal(true),
	source_hashes_verified: z.literal(true),
	source_count: z.number().int().min(1).max(128),
	raw_evidence_revalidated: z.literal(false),
	product_parity_verified: z.literal(false),
	predictions: z.literal(26),
	conversions: z.literal(24),
	manifest_frames: z.literal(7),
	report_sha256: z
		.object({ capture: sha, sequence_replay: sha, sequence_render: sha })
		.strict(),
});
export const payloadSchema = z.object({
	...dimensions,
	version: z.literal(1),
	coordinate_space: z.literal("normalized-bottom-left"),
	image_sha256: sha,
	frames: z.array(z.unknown()).length(24),
});
