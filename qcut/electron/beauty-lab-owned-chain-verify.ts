import type { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { buildJianyingPortraitFeatureParameters } from "./jianying-portrait-adjustment-runtime/catalog.js";
import {
	OWNED_CHAIN_CAPTURE_SOURCES,
	OWNED_CHAIN_LEGACY_PROBE_SHA256,
	OWNED_CHAIN_ORIGINAL_FORMAT,
	OWNED_CHAIN_ORIGINAL_SOURCES,
	ownedChainAuditSchema,
	ownedChainCandidateSchema,
	ownedChainCaptureSchema,
	ownedChainModelSchema,
	ownedChainOriginalAuditSchema,
	ownedChainOriginalCaptureSchema,
	ownedChainOriginalReportSchema,
	ownedChainPayloadSchema,
	ownedChainRenderSchema,
	ownedChainSourceSchema,
	ownedChainSummarySchema,
	type OwnedChainIndex,
} from "./beauty-lab/beauty-lab-owned-chain-evidence.js";
import { requireEvidence } from "./beauty-lab-research-files.js";

export interface OwnedChainReports {
	chainAudit?: z.infer<typeof ownedChainAuditSchema>;
	capture: z.infer<typeof ownedChainCaptureSchema>;
	candidate: z.infer<typeof ownedChainCandidateSchema>;
	render: z.infer<typeof ownedChainRenderSchema>;
	model: z.infer<typeof ownedChainModelSchema>;
	summary: z.infer<typeof ownedChainSummarySchema>;
	originalCapture: z.infer<typeof ownedChainOriginalCaptureSchema>;
	originalReplay: z.infer<typeof ownedChainOriginalReportSchema>;
	originalRender: z.infer<typeof ownedChainOriginalReportSchema>;
	originalAudit: z.infer<typeof ownedChainOriginalAuditSchema>;
}

function verifyOriginalProducer({
	index,
	reports,
}: {
	index: OwnedChainIndex;
	reports: OwnedChainReports;
}) {
	const { candidate, render, chainAudit: audit, model } = reports;
	if (
		candidate.profile !== "original-rgba-owned-chain-v1" ||
		render.profile !== "original-rgba-owned-chain-render-v1" ||
		!audit
	) {
		throw new Error(
			"Beauty Lab research: original-frame profile/audit mismatch"
		);
	}
	requireEvidence({
		condition:
			audit.capture_sha256 === index.reports.capture &&
			audit.candidate_report_sha256 === index.reports.candidate &&
			audit.render_report_sha256 === index.reports.render &&
			audit.model_report_sha256 === index.reports.model &&
			audit.replay_sha256 === index.replay_sha256 &&
			render.candidate_report_sha256 === index.reports.candidate &&
			isDeepStrictEqual(audit.preprocessing, candidate.preprocessing) &&
			isDeepStrictEqual(audit.comparisons, render.comparisons) &&
			isDeepStrictEqual(
				candidate.sampling_cases,
				candidate.preprocessing.sampling_cases
			) &&
			isDeepStrictEqual(
				candidate.initialization_sampling_cases,
				candidate.preprocessing.initialization_sampling_cases
			),
		message: "original-frame audit/producer binding differs",
	});
	for (const [sources, expected] of [
		[candidate.source_sha256, OWNED_CHAIN_ORIGINAL_SOURCES],
		[
			render.source_sha256,
			[
				...OWNED_CHAIN_ORIGINAL_SOURCES,
				"local-model-pytorch/face_preprocess_chain_render.py",
			],
		],
		[
			audit.source_sha256,
			["local-model-pytorch/face_preprocess_chain_audit.py"],
		],
	] as const) {
		requireEvidence({
			condition: isDeepStrictEqual(
				Object.keys(sources).sort(),
				[...expected].sort()
			),
			message: "original-frame producer source closure differs",
		});
	}
	const auditedFixtures = new Set(Object.values(audit.fixture_sha256));
	for (const key of [
		"capture",
		"candidate",
		"render",
		"model",
		"summary",
	] as const) {
		requireEvidence({
			condition: auditedFixtures.has(index.reports[key]),
			message: "original-frame audited fixture missing",
		});
	}
	const proof = candidate.preprocessing;
	for (const [position, source] of proof.source_frames.entries()) {
		requireEvidence({
			condition:
				source.index === position &&
				source.original_rgba_sha256 ===
					index.frames[position].input_rgba_sha256 &&
				candidate.fixture_sha256[source.path] === source.original_rgba_sha256 &&
				audit.fixture_sha256[source.path] === source.original_rgba_sha256,
			message: "original-frame input identity differs",
		});
	}
	for (const [prediction, observation] of proof.observations.entries()) {
		const frame = prediction < 14 ? 0 : Math.floor((prediction - 12) / 2);
		const source = proof.source_frames[frame];
		requireEvidence({
			condition:
				observation.prediction === prediction &&
				observation.frame_index === frame &&
				observation.original_rgba_sha256 === source.original_rgba_sha256 &&
				observation.generated_algorithm_sha256 ===
					source.generated_algorithm_sha256 &&
				observation.oracle_sha256 === source.generated_algorithm_sha256,
			message: "original-frame observation association differs",
		});
		const sample = proof.sampling_cases[prediction];
		if ("idle" in sample) {
			requireEvidence({
				condition: prediction === 19,
				message: "original-frame idle prediction differs",
			});
			continue;
		}
		const inference = prediction < 19 ? prediction : prediction - 1;
		const head = model.model_outputs["120"].cases[inference];
		requireEvidence({
			condition:
				prediction !== 19 &&
				sample.prediction === prediction &&
				sample.inference === inference &&
				sample.active === (prediction !== 18) &&
				sample.algorithm_frame_sha256 === source.generated_algorithm_sha256 &&
				head?.input_source === "replacement_inputs" &&
				head.actual_input_sha256 === sample.input_sha256 &&
				head.replacement_input_sha256 === sample.input_sha256,
			message: "original-frame 120 ONNX input differs",
		});
	}
	for (const [
		inference,
		sample,
	] of proof.initialization_sampling_cases.entries()) {
		const prediction = inference === 0 ? 0 : 20;
		const head = model.model_outputs["160"].cases[inference];
		requireEvidence({
			condition:
				sample.prediction === prediction &&
				sample.inference === inference &&
				sample.algorithm_frame_sha256 ===
					proof.observations[prediction].generated_algorithm_sha256 &&
				head.input_source === "replacement_inputs" &&
				head.actual_input_sha256 === sample.generated_tensor_sha256 &&
				head.replacement_input_sha256 === sample.generated_tensor_sha256,
			message: "original-frame 160 ONNX input differs",
		});
	}
}

function mergeSources({ groups }: { groups: Record<string, string>[] }) {
	const sources = new Map<string, string>();
	for (const group of groups) {
		for (const [name, hash] of Object.entries(group)) {
			requireEvidence({
				condition: !sources.has(name) || sources.get(name) === hash,
				message: "conflicting owned-chain source hashes",
			});
			sources.set(name, hash);
		}
	}
	return Object.fromEntries(
		[...sources].sort(([a], [b]) => a.localeCompare(b))
	);
}

export function verifyOwnedChainReports({
	index,
	reports,
	payload,
}: {
	index: OwnedChainIndex;
	reports: OwnedChainReports;
	payload: z.infer<typeof ownedChainPayloadSchema>;
}): Record<string, string> {
	const {
		capture,
		candidate,
		render,
		model,
		summary,
		originalCapture,
		originalAudit,
	} = reports;
	const originalFrames = index.format === OWNED_CHAIN_ORIGINAL_FORMAT;
	if (originalFrames) verifyOriginalProducer({ index, reports });
	else
		requireEvidence({
			condition:
				candidate.profile === "actual-preprocess-owned-chain-v1" &&
				render.profile === "actual-preprocess-owned-chain-render-v1" &&
				reports.chainAudit === undefined,
			message: "legacy owned-chain profile mismatch",
		});
	const originalLinks = originalAudit.report_sha256;
	requireEvidence({
		condition:
			originalLinks.capture === index.reports.originalCapture &&
			originalLinks.sequence_replay === index.reports.originalReplay &&
			originalLinks.sequence_render === index.reports.originalRender &&
			candidate.capture_sha256 === index.reports.capture &&
			render.capture_sha256 === index.reports.capture &&
			model.capture_sha256 === index.reports.capture &&
			candidate.model_report_sha256 === index.reports.model &&
			model.export_summary_sha256 === index.reports.summary &&
			candidate.replay_sha256 === index.replay_sha256 &&
			render.replay_sha256 === index.replay_sha256 &&
			payload.image_sha256 === index.manifest_sha256 &&
			originalCapture.fixture_sha256[originalCapture.manifest] ===
				index.manifest_sha256,
		message: "owned-chain report, capture, model or replay link differs",
	});
	const captureFixtures = new Set(Object.values(capture.fixture_sha256));
	const candidateFixtures = new Set(Object.values(candidate.fixture_sha256));
	for (const key of [
		"originalCapture",
		"originalReplay",
		"originalRender",
		"originalAudit",
	] as const) {
		requireEvidence({
			condition:
				captureFixtures.has(index.reports[key]) &&
				candidateFixtures.has(index.reports[key]),
			message: "owned-chain original guard link missing",
		});
	}
	const originalSources = mergeSources({
		groups: [
			originalCapture.source_sha256,
			reports.originalReplay.source_sha256,
			reports.originalRender.source_sha256,
		],
	});
	requireEvidence({
		condition: Object.keys(originalSources).length === 50,
		message: "owned-chain original source guard must contain 50 files",
	});
	const modelSources = Object.fromEntries(
		Object.entries(model.source_sha256).map(([name, hash]) => [
			`local-model-pytorch/${name}`,
			hash,
		])
	);
	ownedChainSourceSchema.parse(modelSources);
	const captureSources = Object.fromEntries(
		OWNED_CHAIN_CAPTURE_SOURCES.flatMap((relativePath) => {
			const matches = Object.entries(capture.fixture_sha256).filter(([label]) =>
				label.endsWith(`/research/${relativePath}`)
			);
			if (
				relativePath.endsWith("/face_native_process.py") &&
				matches.length === 0 &&
				!originalFrames
			) {
				const probe = Object.entries(capture.fixture_sha256).filter(([label]) =>
					label.endsWith(
						"/research/local-model-pytorch/face_preprocess_probe.py"
					)
				);
				requireEvidence({
					condition:
						probe.length === 1 &&
						probe[0][1] === OWNED_CHAIN_LEGACY_PROBE_SHA256,
					message:
						"missing cleanup helper requires explicit legacy probe source",
				});
				return [];
			}
			requireEvidence({
				condition: matches.length === 1,
				message: "owned-chain capture source hash missing or ambiguous",
			});
			return [[relativePath, matches[0][1]]];
		})
	);
	const sources = mergeSources({
		groups: [
			originalSources,
			captureSources,
			candidate.source_sha256,
			render.source_sha256,
			modelSources,
			...(reports.chainAudit ? [reports.chainAudit.source_sha256] : []),
		],
	});
	const declared = mergeSources({ groups: [index.source_sha256] });
	requireEvidence({
		condition: JSON.stringify(sources) === JSON.stringify(declared),
		message: "owned-chain source index differs from reports",
	});
	for (const size of ["120", "160"] as const) {
		const output = model.model_outputs[size];
		const count = size === "120" ? 25 : 2;
		requireEvidence({
			condition:
				output.graph_sha256 === summary.networks[size].graph_sha256 &&
				output.onnx_sha256 ===
					summary.artifacts[`align-${size}/artifacts/model.onnx`] &&
				output.successful_inferences === count &&
				output.cases.length === count &&
				output.cases.every((entry, inference) => entry.inference === inference),
			message: "owned-chain model identity or inference inventory differs",
		});
	}
	const labels = [
		"face",
		"motion",
		"mirror",
		"no-face",
		"recovery",
		"zero-effect",
		"half-effect",
	];
	for (const [frameIndex, recorded] of originalCapture.frames.entries()) {
		const exported = index.frames[frameIndex];
		const rendered = render.frames[frameIndex];
		const comparison = render.comparisons[frameIndex];
		const baseIntensity = originalFrames
			? originalCapture.frames[0].parameters.face_adjust_eye[0].intensity
			: 1;
		const intensity =
			frameIndex === 5
				? 0
				: frameIndex === 6
					? baseIntensity / 2
					: baseIntensity;
		const expectedParameters = originalFrames
			? JSON.parse(
					buildJianyingPortraitFeatureParameters({
						runtimePackage: "features",
						values: { face_adjust_eye: intensity * 100 },
					})
				)
			: { face_adjust_eye: [{ id: -1, intensity }] };
		const expectedChange = frameIndex !== 3 && frameIndex !== 5;
		requireEvidence({
			condition:
				baseIntensity > 0 &&
				baseIntensity <= 1 &&
				isDeepStrictEqual(recorded.parameters, expectedParameters) &&
				isDeepStrictEqual(rendered.parameters, expectedParameters) &&
				recorded.label === labels[frameIndex] &&
				recorded.expect_change === expectedChange &&
				recorded.parameters.face_adjust_eye[0].intensity === intensity &&
				rendered.label === recorded.label &&
				rendered.expect_change === expectedChange &&
				rendered.timestamp === recorded.timestamp &&
				rendered.parameters.face_adjust_eye[0].intensity === intensity &&
				exported.input_png_sha256 === recorded.image_sha256 &&
				exported.input_rgba_sha256 === recorded.input_rgba_sha256 &&
				exported.native_rgba_sha256 === exported.candidate_rgba_sha256 &&
				exported.native_rgba_sha256 === comparison.baseline_sha256 &&
				exported.candidate_rgba_sha256 === comparison.sha256 &&
				capture.comparisons[frameIndex].sha256 === comparison.sha256 &&
				originalCapture.comparisons[frameIndex].sha256 === comparison.sha256 &&
				comparison.versus_input.sha256 === comparison.sha256 &&
				comparison.versus_input.equal === !expectedChange &&
				(expectedChange
					? comparison.versus_input.changed_pixels > 0 &&
						comparison.versus_input.max_delta > 0 &&
						comparison.versus_input.bbox !== null
					: comparison.versus_input.changed_pixels === 0 &&
						comparison.versus_input.max_delta === 0 &&
						comparison.versus_input.bbox === null),
			message: `owned-chain frame ${frameIndex} parity or effect/control link differs`,
		});
	}
	for (const [position, replayFrame] of payload.frames.entries()) {
		const frameIndex = position < 12 ? 0 : Math.floor((position - 10) / 2);
		const noFace = position === 16 || position === 17;
		requireEvidence({
			condition:
				replayFrame.timestamp_us ===
					Math.round(originalCapture.frames[frameIndex].timestamp * 1000000) &&
				replayFrame.faces.length === (noFace ? 0 : 1) &&
				(noFace || replayFrame.faces[0].id === (position < 18 ? 0 : 1)),
			message: "owned-chain replay time or face lifecycle differs",
		});
	}
	return sources;
}
