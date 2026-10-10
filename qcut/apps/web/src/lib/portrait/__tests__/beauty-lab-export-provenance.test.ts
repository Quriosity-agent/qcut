import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BeautyLabCandidateResult,
	type BeautyLabIndependentResult,
	BEAUTY_LAB_INDEPENDENT_PROVIDER,
} from "@/types/electron";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "../../../../../../electron/beauty-lab/beauty-lab-candidate-contract";
import { exportBeautyLabComparison } from "../beauty-lab-export";
import {
	candidate,
	canvases,
	draws,
	input,
	installExportCanvasStubs,
	makeCandidateReport,
	makeFrame,
	native,
	openArchive,
	options,
	PNG_BYTES,
	readManifest,
} from "./beauty-lab-export-fixture";

beforeEach(installExportCanvasStubs);

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("exportBeautyLabComparison live candidate provenance", () => {
	it.each([
		{ native },
		{ native: null },
	])("exports static-only readiness without promoting arbitrary-frame acceptance (native=$native)", async ({
		native: baseline,
	}) => {
		const candidateReport: BeautyLabCandidateResult = {
			...makeCandidateReport(),
			scope: "audited-single-static-frame",
			timingScope: "cumulative-owned-worker-including-warmup",
			nativeDependencies: ["detection", "geometry", "effect-rendering"],
			stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) =>
				["detection", "geometry", "effect-rendering"].includes(id)
					? {
							id,
							durationMs: null,
							unavailableReason: "native-stage-not-instrumented",
						}
					: { id, durationMs: 1.25 }
			),
		};
		const before = JSON.stringify(candidateReport);
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				native: baseline,
				record: null,
				candidateReport,
			}),
		});
		const manifest = await readManifest({ zip });
		expect(manifest).toMatchObject({
			schema: "qcut-beauty-lab-comparison-v1",
			mode: "live-candidate",
			record: null,
			arbitraryFrameCandidateReady: false,
			staticAuditReady: true,
			nativeResultPresent: baseline !== null,
			candidateResultPresent: true,
		});
		const { rgba: _rgba, ...provenance } = candidateReport;
		expect(manifest.candidateProvenance).toEqual(provenance);
		expect(zip.file("candidate.png")).not.toBeNull();
		expect(JSON.stringify(candidateReport)).toBe(before);
	});

	it("exports live metadata and stage metrics without RGBA, using the current input's WebCrypto digest", async () => {
		const candidateReport = makeCandidateReport();
		const before = JSON.stringify(candidateReport);
		const digest = vi.spyOn(webcrypto.subtle, "digest");
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				record: null,
				candidateReport,
			}),
		});
		const manifest = await readManifest({ zip });
		const { rgba: reportPixels, ...provenance } = candidateReport;
		expect(manifest).not.toHaveProperty("staticAuditReady");
		expect(manifest).toMatchObject({
			mode: "live-candidate",
			record: null,
			arbitraryFrameCandidateReady: true,
			nativeDependencies: true,
			nativeResultPresent: true,
			candidateResultPresent: true,
		});
		expect(manifest.candidateProvenance).toEqual(provenance);
		expect(manifest.candidateProvenance).not.toHaveProperty("rgba");
		expect(manifest.candidateProvenance?.stageMetrics).toHaveLength(10);
		expect(digest).toHaveBeenCalledTimes(1);
		expect(digest.mock.calls[0][0]).toBe("SHA-256");
		expect(new Uint8Array(digest.mock.calls[0][1] as ArrayBuffer)).toEqual(
			input.rgba
		);
		expect(manifest.comparisons.map(({ name }) => name)).toEqual([
			"original-native",
			"original-candidate",
			"native-candidate",
		]);
		expect(Object.keys(zip.files).sort()).toEqual([
			"candidate.png",
			"comparison.json",
			"difference-native-candidate.png",
			"difference-original-candidate.png",
			"difference-original-native.png",
			"native.png",
			"original.png",
		]);
		expect(Array.from(draws[2].rgba)).toEqual(Array.from(reportPixels));
		expect(JSON.stringify(candidateReport)).toBe(before);
	});

	it.each([
		{ nativeDependencies: [] },
		{ nativeDependencies: ["effect-rendering"] as const },
	])("derives native dependencies from the report when no native baseline is exported ($nativeDependencies)", async ({
		nativeDependencies,
	}) => {
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				record: null,
				native: null,
				candidateReport: {
					...makeCandidateReport(),
					nativeDependencies: [...nativeDependencies],
				},
			}),
		});
		expect(await readManifest({ zip })).toMatchObject({
			mode: "live-candidate",
			arbitraryFrameCandidateReady: true,
			nativeResultPresent: false,
			candidateResultPresent: true,
			nativeDependencies: nativeDependencies.length > 0,
			candidateProvenance: { nativeDependencies: [...nativeDependencies] },
		});
		expect(zip.file("native.png")).toBeNull();
		expect(zip.file("difference-native-candidate.png")).toBeNull();
	});

	it("hashes only the current RGBA view, not unrelated bytes in its backing buffer", async () => {
		const backing = new Uint8Array([99, ...input.rgba, 88]);
		const inputFrame = { ...input, rgba: backing.subarray(1, 5) };
		const candidateReport = makeCandidateReport({ inputFrame });
		expect(candidateReport.inputSha256).not.toBe(
			createHash("sha256").update(backing).digest("hex")
		);
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				input: inputFrame,
				record: null,
				candidateReport,
			}),
		});
		expect((await readManifest({ zip })).candidateProvenance?.inputSha256).toBe(
			createHash("sha256").update(input.rgba).digest("hex")
		);
		expect(backing).toEqual(new Uint8Array([99, ...input.rgba, 88]));
	});

	it.each([
		{ candidateReport: undefined },
		{ candidateReport: null },
	])("rejects non-record candidate pixels with missing report $candidateReport before encoding", async ({
		candidateReport,
	}) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidateReport,
			})
		).rejects.toThrow("requires request provenance");
		expect(draws).toHaveLength(0);
		expect(canvases.size).toBe(0);
	});

	it.each([
		{ mismatch: "mixed record", record: options.record, candidate },
		{ mismatch: "missing pixels", record: null, candidate: null },
		{
			mismatch: "mixed record without pixels",
			record: options.record,
			candidate: null,
		},
	])("rejects report with $mismatch", async ({ record, candidate }) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				record,
				candidate,
				candidateReport: makeCandidateReport(),
			})
		).rejects.toThrow("provenance does not match exported pixels");
		expect(draws).toHaveLength(0);
		expect(canvases.size).toBe(0);
	});

	it.each([
		{ field: "protocol", value: "unknown-protocol" },
		{ field: "backendId", value: "untrusted-provider" },
		{ field: "source", value: "verified-offline-replay" },
		{ field: "source", value: "native-live" },
		{ field: "width", value: 2 },
		{ field: "height", value: 2 },
		{ field: "rgba", value: new Uint8Array(3) },
		{ field: "rgba", value: new Uint8Array(5) },
		{ field: "rgba", value: new Uint8Array([9, 0, 0, 255]) },
		{ field: "rgba", value: new Uint8Array([8, 0, 0, 0]) },
		{ field: "rgba", value: [8, 0, 0, 255] },
	])("rejects corrupted report $field=$value before encoding", async ({
		field,
		value,
	}) => {
		const candidateReport = {
			...makeCandidateReport(),
			[field]: value,
		} as unknown as BeautyLabCandidateResult;
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidateReport,
			})
		).rejects.toThrow("provenance does not match exported pixels");
		expect(draws).toHaveLength(0);
		expect(canvases.size).toBe(0);
	});

	it.each([
		{ change: "red", rgba: new Uint8Array([9, 0, 0, 255]) },
		{ change: "alpha", rgba: new Uint8Array([8, 0, 0, 0]) },
		{ change: "short RGBA", rgba: new Uint8Array(3) },
		{ change: "long RGBA", rgba: new Uint8Array(5) },
	])("rejects candidate $change changed after reporting", async ({ rgba }) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidate: { ...candidate, rgba },
				candidateReport: makeCandidateReport(),
			})
		).rejects.toThrow("provenance does not match exported pixels");
		expect(draws).toHaveLength(0);
	});

	it.each([
		{ width: 2, height: 1 },
		{ width: 1, height: 2 },
	])("rejects candidate dimensions $width x $height independently of report dimensions", async ({
		width,
		height,
	}) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidate: { ...candidate, width, height, rgba: new Uint8Array(8) },
				candidateReport: makeCandidateReport(),
			})
		).rejects.toThrow("provenance does not match exported pixels");
		expect(draws).toHaveLength(0);
	});

	it("rejects a valid report from another input with identical dimensions", async () => {
		const otherInput = makeFrame({ name: "different-source", red: 99 });
		await expect(
			exportBeautyLabComparison({
				...options,
				input: otherInput,
				record: null,
				candidateReport: makeCandidateReport(),
			})
		).rejects.toThrow("provenance does not match the exported input");
		expect(draws).toHaveLength(0);
		expect(canvases.size).toBe(0);
	});

	it("rejects matching report and candidate dimensions that differ from the current input", async () => {
		const candidateFrame = { ...candidate, width: 2, rgba: new Uint8Array(8) };
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidate: candidateFrame,
				candidateReport: makeCandidateReport({ candidateFrame }),
			})
		).rejects.toThrow("provenance does not match exported pixels");
		expect(draws).toHaveLength(0);
	});

	it.each([
		{ field: "inputSha256", value: "0".repeat(64) },
		{ field: "inputSha256", value: "not-a-digest" },
		{ field: "requestFingerprint", value: "" },
		{ field: "requestFingerprint", value: "a".repeat(63) },
		{ field: "requestFingerprint", value: "a".repeat(65) },
		{ field: "requestFingerprint", value: "g".repeat(64) },
		{ field: "requestFingerprint", value: "A".repeat(64) },
	])("rejects invalid hash provenance $field=$value", async ({
		field,
		value,
	}) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidateReport: { ...makeCandidateReport(), [field]: value },
			})
		).rejects.toThrow("provenance does not match the exported input");
		expect(draws).toHaveLength(0);
		expect(canvases.size).toBe(0);
	});

	it("keeps record exports offline with null live provenance, even when replay pixels match native", async () => {
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				candidate: { ...candidate, rgba: native.rgba.slice() },
				candidateReport: null,
			}),
		});
		const manifest = await readManifest({ zip });
		expect(manifest).not.toHaveProperty("staticAuditReady");
		expect(manifest).toMatchObject({
			mode: "verified-offline-replay",
			record: options.record,
			arbitraryFrameCandidateReady: false,
			candidateProvenance: null,
		});
	});
});

function makeIndependentReport(): BeautyLabIndependentResult {
	return {
		provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
		requestId: "owned-test",
		sourceKey: "photo-test",
		width: 1,
		height: 1,
		rgba: candidate.rgba.slice(),
		png: PNG_BYTES.slice(),
		inputSha256: createHash("sha256").update(input.rgba).digest("hex"),
		outputSha256: createHash("sha256").update(candidate.rgba).digest("hex"),
		report: {
			passed: true,
			nativeInputsUsed: false,
			nativeGeometryUsed: false,
			nativeFallbackUsed: false,
			nativeProductParityVerified: false,
			outputPngSha256: createHash("sha256").update(PNG_BYTES).digest("hex"),
		},
	};
}
describe("independent export provenance", () => {
	it("exports both rendered paths, pairwise differences and bounded independent provenance", async () => {
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				record: null,
				candidate: null,
				independent: candidate,
				independentReport: makeIndependentReport(),
			}),
		});
		expect(Object.keys(zip.files).sort()).toEqual([
			"comparison.json",
			"difference-native-independent.png",
			"difference-original-independent.png",
			"difference-original-native.png",
			"independent.png",
			"native.png",
			"original.png",
		]);
		const manifest = await readManifest({ zip });
		expect(manifest).toMatchObject({
			independentResultPresent: true,
			nativeResultPresent: true,
			independentProvenance: {
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				report: { nativeInputsUsed: false, nativeProductParityVerified: false },
			},
		});
		const provenance = (
			manifest as unknown as { independentProvenance: Record<string, unknown> }
		).independentProvenance;
		expect(provenance).not.toHaveProperty("rgba");
		expect(provenance).not.toHaveProperty("png");
	});
	it.each([
		"wrong-input",
		"wrong-output",
		"private-native",
		"missing-report",
	])("rejects %s before PNG encoding", async (failure) => {
		const independentReport = makeIndependentReport();
		if (failure === "wrong-input")
			independentReport.inputSha256 = "0".repeat(64);
		if (failure === "wrong-output") independentReport.rgba[0] = 1;
		if (failure === "private-native")
			independentReport.report.nativeInputsUsed = true;
		await expect(
			exportBeautyLabComparison({
				...options,
				record: null,
				candidate: null,
				independent: candidate,
				independentReport:
					failure === "missing-report" ? null : independentReport,
			})
		).rejects.toThrow(/Independent/);
		expect(draws).toHaveLength(0);
	});
});
