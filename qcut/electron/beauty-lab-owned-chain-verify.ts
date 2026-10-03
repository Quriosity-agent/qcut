import type { z } from "zod";
import {
	OWNED_CHAIN_CAPTURE_SOURCES,
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
} from "./beauty-lab-owned-chain-evidence.js";
import { requireEvidence } from "./beauty-lab-research-files.js";

export interface OwnedChainReports {
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
		OWNED_CHAIN_CAPTURE_SOURCES.map((relativePath) => {
			const matches = Object.entries(capture.fixture_sha256).filter(([label]) =>
				label.endsWith(`/research/${relativePath}`)
			);
			requireEvidence({
				condition: matches.length === 1,
				message: "owned-chain capture source hash missing or ambiguous",
			});
			return [relativePath, matches[0][1]];
		})
	);
	const sources = mergeSources({
		groups: [
			originalSources,
			captureSources,
			candidate.source_sha256,
			render.source_sha256,
			modelSources,
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
		const intensity = frameIndex === 5 ? 0 : frameIndex === 6 ? 0.5 : 1;
		const expectedChange = frameIndex !== 3 && frameIndex !== 5;
		requireEvidence({
			condition:
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
