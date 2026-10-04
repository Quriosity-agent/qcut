import JSZip from "jszip";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	type BeautyLabCandidateResult,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	compareBeautyLabFrames,
	validateBeautyLabFrame,
	type BeautyLabFrame,
} from "./beauty-lab-difference";

async function encodeFrame({
	frame,
}: {
	frame: BeautyLabFrame;
}): Promise<Uint8Array> {
	validateBeautyLabFrame({ frame });
	const canvas = document.createElement("canvas");
	canvas.width = frame.width;
	canvas.height = frame.height;
	try {
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas unavailable");
		const data = context.createImageData(frame.width, frame.height);
		data.data.set(frame.rgba);
		context.putImageData(data, 0, 0);
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(new Error("PNG encoding failed")),
				"image/png"
			);
		});
		return new Uint8Array(await blob.arrayBuffer());
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}

export async function exportBeautyLabComparison({
	input,
	native,
	candidate,
	gain,
	adjustments,
	record,
	candidateReport = null,
}: {
	input: BeautyLabFrame;
	native: BeautyLabFrame | null;
	candidate: BeautyLabFrame | null;
	gain: number;
	adjustments: MediaPortraitAdjustments;
	record: { caseId: string; frameIndex: number } | null;
	candidateReport?: BeautyLabCandidateResult | null;
}): Promise<Blob> {
	if (!Number.isInteger(gain) || gain < 1 || gain > 32)
		throw new Error("Invalid difference gain");
	if (candidate && !record && !candidateReport)
		throw new Error("Live candidate export requires request provenance");
	if (
		candidateReport &&
		(record ||
			!candidate ||
			candidateReport.source !== "live-candidate" ||
			candidateReport.protocol !== BEAUTY_LAB_CANDIDATE_PROTOCOL ||
			candidateReport.backendId !== BEAUTY_LAB_CANDIDATE_BACKEND ||
			candidateReport.width !== input.width ||
			candidateReport.height !== input.height ||
			candidateReport.width !== candidate.width ||
			candidateReport.height !== candidate.height ||
			!(candidateReport.rgba instanceof Uint8Array) ||
			!(candidate.rgba instanceof Uint8Array) ||
			candidateReport.rgba.byteLength !== candidate.rgba.byteLength ||
			candidate.rgba.some(
				(value, index) => value !== candidateReport.rgba[index]
			))
	) {
		throw new Error("Candidate provenance does not match exported pixels");
	}
	if (candidateReport) {
		const inputDigest = await crypto.subtle.digest(
			"SHA-256",
			new Uint8Array(input.rgba).buffer
		);
		const inputSha256 = Array.from(new Uint8Array(inputDigest), (value) =>
			value.toString(16).padStart(2, "0")
		).join("");
		if (
			candidateReport.inputSha256 !== inputSha256 ||
			!/^[a-f0-9]{64}$/.test(candidateReport.requestFingerprint)
		) {
			throw new Error("Candidate provenance does not match the exported input");
		}
	}
	const candidateProvenance = candidateReport
		? (({ rgba: _rgba, ...metadata }) => metadata)(candidateReport)
		: null;
	const staticAuditReady =
		candidateReport?.scope === "audited-single-static-frame";
	const zip = new JSZip();
	const frames = [{ name: "original", frame: input }];
	if (native) frames.push({ name: "native", frame: native });
	if (candidate) frames.push({ name: "candidate", frame: candidate });
	const comparisons = [
		{ name: "original-native", reference: input, candidate: native },
		{ name: "original-candidate", reference: input, candidate },
		{ name: "native-candidate", reference: native, candidate },
	].flatMap((pair) => {
		if (!pair.reference || !pair.candidate) return [];
		const result = compareBeautyLabFrames({
			reference: pair.reference,
			candidate: pair.candidate,
			gain,
		});
		frames.push({ name: `difference-${pair.name}`, frame: result.difference });
		return [{ name: pair.name, ...result.metrics }];
	});
	const encoded = await Promise.all(
		frames.map(async ({ name, frame }) => ({
			name,
			bytes: await encodeFrame({ frame }),
		}))
	);
	for (const { name, bytes } of encoded) zip.file(`${name}.png`, bytes);
	zip.file(
		"comparison.json",
		JSON.stringify(
			{
				schema: "qcut-beauty-lab-comparison-v1",
				createdAt: new Date().toISOString(),
				inputName: input.name,
				width: input.width,
				height: input.height,
				gain,
				adjustments,
				mode: record
					? "verified-offline-replay"
					: candidateReport
						? "live-candidate"
						: "native-live",
				record,
				nativeDependencies: Boolean(
					record || native || candidateReport?.nativeDependencies.length
				),
				candidateProvenance,
				nativeResultPresent: native !== null,
				candidateResultPresent: candidate !== null,
				arbitraryFrameCandidateReady:
					candidateReport !== null && candidateReport.scope === undefined,
				...(staticAuditReady ? { staticAuditReady: true } : {}),
				comparisons,
			},
			null,
			2
		)
	);
	return zip.generateAsync({ type: "blob" });
}
