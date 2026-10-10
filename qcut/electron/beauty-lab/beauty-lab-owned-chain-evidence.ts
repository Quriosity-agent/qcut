import { z } from "zod";
import { sha, FRAME_COUNT } from "../beauty-lab-research-evidence.js";
import { jianyingPortraitControlsForRuntimePackage } from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	WIDTH,
	HEIGHT,
	safeRelativePath,
} from "../beauty-lab-research-files.js";

export const OWNED_CHAIN_CASE_ID = "owned-preprocess";
export const OWNED_CHAIN_PACKAGE_FORMAT = "qcut-beauty-lab-owned-chain-v1";
export const OWNED_CHAIN_ORIGINAL_FORMAT =
	"qcut-beauty-lab-original-rgba-owned-chain-v1";
export const OWNED_CHAIN_LEGACY_PROBE_SHA256 =
	"4e40b69fc56d9961c52ec842f2ed92e99d383b87f047e4aad2daba5159ffbfea";
export const OWNED_CHAIN_CAPTURE_SOURCES = [
	"local-model-pytorch/face_preprocess_probe.py",
	"local-model-pytorch/face_preprocess_lldb.py",
	"local-model-pytorch/face_preprocess_memory.py",
	"local-model-pytorch/face_native_process.py",
] as const;
export const OWNED_CHAIN_ORIGINAL_SOURCES = [
	"face_preprocess_chain_replay.py",
	"face_preprocess_chain_capture.py",
	"face_preprocess_chain_inputs.py",
	"face_preprocess_replay.py",
	"face_full_frame_owned.py",
	"face_full_frame_owned_inputs.py",
	"face_full_frame_quantization.py",
	"face_full_frame_quantization_probe.py",
	"face_alignment_sampling.py",
	"face_host_sampling_inputs.py",
].map((name) => `local-model-pytorch/${name}`);
export const OWNED_CHAIN_REPORT_FILES = {
	capture: "reports/capture.json",
	candidate: "reports/candidate.json",
	render: "reports/render.json",
	model: "reports/model.json",
	summary: "reports/summary.json",
	originalCapture: "reports/original-capture.json",
	originalReplay: "reports/original-replay.json",
	originalRender: "reports/original-render.json",
	originalAudit: "reports/original-audit.json",
} as const;

const empty = z.array(z.unknown()).length(0);
const passed = { passed: z.literal(true), failures: empty };
const completed = { ...passed, completed: z.literal(true) };
const dimensions = { width: z.literal(WIDTH), height: z.literal(HEIGHT) };
export const ownedChainSourceSchema = z.record(sha).refine((sources) => {
	const names = Object.keys(sources);
	if (names.length < 1 || names.length > 128) return false;
	return names.every((relativePath) => {
		try {
			safeRelativePath({ relativePath });
			return /^(local-model-pytorch|jianying-runtime-probe)\//.test(
				relativePath
			);
		} catch {
			return false;
		}
	});
});

// Exporter copies the original bytes to these fixed names, never rewrites the reports.
export const ownedChainIndexSchema = z
	.object({
		format: z.enum([OWNED_CHAIN_PACKAGE_FORMAT, OWNED_CHAIN_ORIGINAL_FORMAT]),
		reports: z
			.object({
				capture: sha,
				candidate: sha,
				render: sha,
				model: sha,
				summary: sha,
				originalCapture: sha,
				originalReplay: sha,
				originalRender: sha,
				originalAudit: sha,
				chainAudit: sha.optional(),
			})
			.strict(),
		manifest_sha256: sha,
		replay_sha256: sha,
		source_sha256: ownedChainSourceSchema,
		frames: z
			.array(
				z
					.object({
						index: z.number().int().min(0).max(6),
						input_png_sha256: sha,
						input_rgba_sha256: sha,
						native_rgba_sha256: sha,
						candidate_rgba_sha256: sha,
					})
					.strict()
			)
			.length(FRAME_COUNT)
			.refine((frames) =>
				frames.every((frame, index) => frame.index === index)
			),
	})
	.strict()
	.refine(
		(value) =>
			(value.format === OWNED_CHAIN_ORIGINAL_FORMAT) ===
			(value.reports.chainAudit !== undefined)
	);
export type OwnedChainIndex = z.infer<typeof ownedChainIndexSchema>;

const featureKeys = new Set<string>(
	jianyingPortraitControlsForRuntimePackage({ runtimePackage: "features" }).map(
		({ key }) => key
	)
);
const parameters = z
	.record(
		z
			.array(
				z
					.object({
						id: z.literal(-1),
						intensity: z.number().finite().min(0).max(1),
					})
					.strict()
			)
			.length(1)
	)
	.refine(
		(value) =>
			Boolean(value.face_adjust_eye) &&
			Object.entries(value).every(
				([key, entries]) =>
					key === "face_adjust_eye" ||
					(featureKeys.has(key) && entries[0].intensity === 0)
			)
	);
const frame = z.object({
	timestamp: z.number().finite().min(0).max(60),
	parameters,
	expect_change: z.boolean(),
	label: z.enum([
		"face",
		"motion",
		"mirror",
		"no-face",
		"recovery",
		"zero-effect",
		"half-effect",
	]),
});
const frames = z.array(frame).length(FRAME_COUNT);
const originalFrames = z
	.array(frame.extend({ image_sha256: sha, input_rgba_sha256: sha }))
	.length(FRAME_COUNT);
const equality = {
	equal: z.literal(true),
	changed_pixels: z.literal(0),
	max_delta: z.literal(0),
	bbox: z.null(),
	sha256: sha,
};
const comparisons = z
	.array(z.object({ index: z.number().int(), ...equality }))
	.length(FRAME_COUNT)
	.refine((rows) => rows.every((row, index) => row.index === index));
const fixtureHashes = z.record(sha);
export const ownedChainCaptureSchema = z.object({
	...passed,
	diagnostic_only: z.literal(true),
	native_analysis_bypassed: z.literal(false),
	observer_pixel_parity_verified: z.literal(true),
	product_parity_verified: z.literal(false),
	old_sources_verified: z.literal(50),
	comparisons,
	fixture_sha256: fixtureHashes,
});
export const ownedChainOriginalCaptureSchema = z.object({
	...passed,
	...dimensions,
	frames: originalFrames,
	comparisons,
	manifest: z.string().min(1).max(4096),
	source_sha256: ownedChainSourceSchema,
	fixture_sha256: fixtureHashes,
	native_analysis_bypassed: z.literal(false),
	predictions: z.literal(26),
});
export const ownedChainOriginalReportSchema = z.object({
	...completed,
	source_sha256: ownedChainSourceSchema,
});
export const ownedChainOriginalAuditSchema = z.object({
	...completed,
	source_count: z.literal(50),
	source_hashes_verified: z.literal(true),
	pipeline_parity: z.literal(true),
	report_sha256: z
		.object({ capture: sha, sequence_replay: sha, sequence_render: sha })
		.strict(),
});
const exactCheck = z.object({ exact: z.literal(true), max_abs: z.literal(0) });
const legacyCandidateSchema = z.object({
	...completed,
	profile: z.literal("actual-preprocess-owned-chain-v1"),
	diagnostic_only: z.literal(false),
	geometry_exact: z.literal(true),
	final_consumer_parity: z.literal(true),
	captured_tensor_input_used: z.literal(false),
	native_final_point_input_used: z.literal(false),
	native_analysis_bypassed: z.literal(false),
	product_parity_verified: z.literal(false),
	arbitrary_frame_backend_connected: z.literal(false),
	independent_full_frame_preprocessing: z.literal(false),
	original_rgba_input_used: z.literal(false).optional(),
	independent_120_sampling_input_used: z.literal(true),
	independent_160_sampling_input_used: z.literal(true),
	owned_initialization_used: z.literal(true),
	owned_temporal_smoothing_used: z.literal(true),
	native_smoothing_seed_predictions: empty,
	owned_smoothing_seed_predictions: z.tuple([z.literal(0), z.literal(20)]),
	native_smoothing_seed_required: z.literal(false),
	native_algorithm_rgba_required: z.literal(true),
	native_caller_parameters_required: z.literal(true),
	manifest_frames: z.literal(7),
	head_comparisons: z.literal(135),
	capture_sha256: sha,
	model_report_sha256: sha,
	replay_sha256: sha,
	source_sha256: ownedChainSourceSchema,
	fixture_sha256: fixtureHashes,
	cases: z
		.array(
			z.object({
				prediction: z.number().int(),
				active_faces: z.number().int().min(0).max(1),
				published_faces: z.number().int().min(0).max(1),
			})
		)
		.length(26)
		.refine((rows) =>
			rows.every(
				(row, index) =>
					row.prediction === index &&
					row.published_faces === (index === 18 || index === 19 ? 0 : 1)
			)
		),
	initialization_sampling_cases: z
		.array(
			z.object({
				prediction: z.number().int(),
				passed: z.literal(true),
				checks: z.object({
					source: exactCheck,
					crop: exactCheck,
					resized: exactCheck,
					tensor: exactCheck,
					post_crop_rect: z.object({ exact: z.literal(true) }),
				}),
			})
		)
		.length(2)
		.refine((rows) => rows[0].prediction === 0 && rows[1].prediction === 20),
});
const versusInput = z.object({
	equal: z.boolean(),
	changed_pixels: z
		.number()
		.int()
		.min(0)
		.max(WIDTH * HEIGHT),
	max_delta: z.number().int().min(0).max(255),
	bbox: z
		.tuple([
			z.number().int(),
			z.number().int(),
			z.number().int(),
			z.number().int(),
		])
		.nullable(),
	sha256: sha,
});
const legacyRenderSchema = z.object({
	...completed,
	...dimensions,
	profile: z.literal("actual-preprocess-owned-chain-render-v1"),
	original_rgba_input_used: z.literal(false).optional(),
	independent_full_frame_preprocessing: z.literal(false).optional(),
	native_analysis_bypassed: z.literal(false),
	independent_inference_verified: z.literal(false),
	product_parity_verified: z.literal(false),
	arbitrary_frame_backend_connected: z.literal(false),
	external_replay_verified: z.literal(true),
	pixel_parity_verified: z.literal(true),
	capture_sha256: sha,
	replay_sha256: sha,
	source_sha256: ownedChainSourceSchema,
	fixture_sha256: fixtureHashes,
	frames,
	comparisons: z
		.array(
			z.object({
				index: z.number().int(),
				...equality,
				baseline_sha256: sha,
				versus_input: versusInput,
			})
		)
		.length(FRAME_COUNT)
		.refine((rows) => rows.every((row, index) => row.index === index)),
});

const check = z.object({
	passed: z.literal(true),
	max_abs: z.number().finite().min(0),
	atol: z.literal(0.0001),
	rtol: z.literal(0.00001),
	relative_limit: z.null(),
});
const probabilityCheck = check.extend({
	atol: z.literal(0.000001),
	relative_limit: z.literal(0.001),
});
const headCase = z.object({
	inference: z.number().int(),
	actual_input_sha256: sha.optional(),
	replacement_input_sha256: sha.optional(),
	input_source: z.literal("replacement_inputs").optional(),
	passed: z.literal(true),
	checks: z
		.object({
			fc_landmark_s1: check.extend({
				exact: z.literal(true),
				max_abs: z.literal(0),
				elements: z.literal(212),
			}),
			fc_visible: probabilityCheck,
			prob: probabilityCheck,
			fc_yaw: check,
			fc_pitch: check,
		})
		.strict(),
});
const modelOutput = z.object({
	graph_sha256: sha,
	onnx_sha256: sha,
	successful_inferences: z.number().int(),
	cases: z.array(headCase),
});
const originalClaims = {
	original_rgba_input_used: z.literal(true),
	native_algorithm_rgba_required: z.literal(false),
	native_algorithm_rgba_input_used: z.literal(false),
	native_algorithm_rgba_oracle_required: z.literal(true),
	independent_full_frame_preprocessing: z.literal(true),
	fixed_profile_only: z.literal(true),
};
const algorithmRequest = z.tuple([
	z.literal(0),
	z.literal(640),
	z.literal(480),
	z.literal(2560),
	z.literal(0),
]);
const originalInitialization =
	legacyCandidateSchema.shape.initialization_sampling_cases
		.innerType()
		.element.extend({
			inference: z.number().int().min(0).max(1),
			algorithm_frame_sha256: sha,
			generated_tensor_sha256: sha,
		});
export const ownedChainPreprocessingSchema = z.object({
	algorithm: z.literal("staged-q11"),
	source_size: z.tuple([z.literal(WIDTH), z.literal(HEIGHT)]),
	source_stride: z.literal(WIDTH * 4),
	request: algorithmRequest,
	independent_full_frame_preprocessing: z.literal(true),
	native_algorithm_rgba_input_used: z.literal(false),
	native_algorithm_rgba_oracle_required: z.literal(true),
	native_caller_parameters_required: z.literal(true),
	arbitrary_frame_backend_connected: z.literal(false),
	product_parity_verified: z.literal(false),
	captured_tensor_input_used: z.literal(false),
	original_rgba_input_used: z.literal(true),
	generated_120_inputs: z.literal(25),
	generated_160_inputs: z.literal(2),
	source_frames: z
		.array(
			z.object({
				index: z.number().int(),
				path: z.string().min(1).max(4096),
				original_rgba_sha256: sha,
				generated_algorithm_sha256: sha,
			})
		)
		.length(7),
	observations: z
		.array(
			z.object({
				prediction: z.number().int(),
				frame_index: z.number().int(),
				request: algorithmRequest,
				algorithm_exact: z.literal(true),
				original_rgba_sha256: sha,
				generated_algorithm_sha256: sha,
				oracle_sha256: sha,
			})
		)
		.length(26),
	sampling_cases: z
		.array(
			z.union([
				z.object({ prediction: z.literal(19), idle: z.literal(true) }).strict(),
				z.object({
					prediction: z.number().int(),
					inference: z.number().int(),
					slot: z.literal(0),
					active: z.boolean(),
					sampling_exact: z.literal(true),
					input_sha256: sha,
					algorithm_frame_sha256: sha,
					input_source: z.literal("original-rgba-staged-q11"),
				}),
			])
		)
		.length(26),
	initialization_sampling_cases: z.array(originalInitialization).length(2),
});
export const ownedChainCandidateSchema = z.discriminatedUnion("profile", [
	legacyCandidateSchema,
	legacyCandidateSchema.extend({
		profile: z.literal("original-rgba-owned-chain-v1"),
		...originalClaims,
		preprocessing: ownedChainPreprocessingSchema,
		sampling_cases: ownedChainPreprocessingSchema.shape.sampling_cases,
		initialization_sampling_cases:
			ownedChainPreprocessingSchema.shape.initialization_sampling_cases,
	}),
]);
export const ownedChainRenderSchema = z.discriminatedUnion("profile", [
	legacyRenderSchema,
	legacyRenderSchema.extend({
		profile: z.literal("original-rgba-owned-chain-render-v1"),
		...originalClaims,
		candidate_report_sha256: sha,
	}),
]);
export const ownedChainAuditSchema = z.object({
	...completed,
	...originalClaims,
	profile: z.literal("original-rgba-owned-chain-audit-v1"),
	geometry_exact: z.literal(true),
	final_consumer_parity: z.literal(true),
	pixel_parity_verified: z.literal(true),
	external_replay_verified: z.literal(true),
	native_execution_performed: z.literal(false),
	inference_performed: z.literal(false),
	product_parity_verified: z.literal(false),
	arbitrary_frame_backend_connected: z.literal(false),
	head_comparisons: z.literal(135),
	normalized_conversions: z.literal(24),
	capture_sha256: sha,
	candidate_report_sha256: sha,
	render_report_sha256: sha,
	model_report_sha256: sha,
	replay_sha256: sha,
	source_sha256: ownedChainSourceSchema,
	fixture_sha256: fixtureHashes,
	preprocessing: ownedChainPreprocessingSchema,
	comparisons: legacyRenderSchema.shape.comparisons,
});
export const ownedChainModelSchema = z.object({
	...passed,
	capture_sha256: sha,
	export_summary_sha256: sha,
	expected_comparisons: z.literal(7),
	head_comparisons: z.literal(135),
	independent_120_sampling_input_used: z.literal(true),
	independent_160_sampling_input_used: z.literal(true),
	source_sha256: z.record(sha),
	model_outputs: z.object({ "120": modelOutput, "160": modelOutput }).strict(),
});
export const ownedChainSummarySchema = z.object({
	passed: z.literal(true),
	artifacts: z.record(sha),
	networks: z.object({
		"120": z.object({ graph_sha256: sha }),
		"160": z.object({ graph_sha256: sha }),
	}),
});
export const ownedChainPayloadSchema = z
	.object({
		...dimensions,
		version: z.literal(1),
		coordinate_space: z.literal("normalized-bottom-left"),
		image_sha256: sha,
		frames: z
			.array(
				z
					.object({
						timestamp_us: z.number().int().min(0).max(60000000),
						faces: z
							.array(
								z
									.object({
										id: z.number().int().min(0),
										points: z
											.array(
												z.tuple([z.number().finite(), z.number().finite()])
											)
											.length(106),
									})
									.strict()
							)
							.max(1),
					})
					.strict()
			)
			.length(24),
	})
	.strict();
