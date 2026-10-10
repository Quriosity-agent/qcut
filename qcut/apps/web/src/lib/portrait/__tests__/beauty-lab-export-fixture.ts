import { Blob as NodeBlob, Buffer } from "node:buffer";
import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { expect, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	type BeautyLabCandidateResult,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "../../../../../../electron/beauty-lab/beauty-lab-candidate-contract";
import type { BeautyLabFrame } from "../beauty-lab-difference";

export const PNG_BYTES = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWJ0AAAAASUVORK5CYII=",
		"base64"
	)
);
export const draws: { canvas: HTMLCanvasElement; rgba: Uint8ClampedArray }[] =
	[];
export const canvases = new Set<HTMLCanvasElement>();
const createImageData = vi.fn(
	(width: number, height: number) =>
		({
			width,
			height,
			data: new Uint8ClampedArray(width * height * 4),
			colorSpace: "srgb",
		}) as ImageData
);
const getCanvasContext = function (this: HTMLCanvasElement, contextId: string) {
	if (contextId !== "2d") return null;
	canvases.add(this);
	return {
		createImageData,
		putImageData: (image: ImageData) =>
			draws.push({ canvas: this, rgba: image.data.slice() }),
	} as unknown as CanvasRenderingContext2D;
} as HTMLCanvasElement["getContext"];

export function makeFrame({
	name,
	red,
	alpha = 255,
}: {
	name: string;
	red: number;
	alpha?: number;
}): BeautyLabFrame {
	return {
		name,
		width: 1,
		height: 1,
		rgba: new Uint8Array([red, 0, 0, alpha]),
	};
}

export const input = makeFrame({ name: "../../original-photo.jpg", red: 0 });
export const native = makeFrame({ name: "Native renderer", red: 2 });
export const candidate = makeFrame({ name: "Verified replay", red: 8 });
export const adjustments: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_Smooth: 65 },
	faces: [{ trackId: 2, values: { face_adjust_Smooth: 40 } }],
};
export const options = {
	input,
	native,
	candidate,
	gain: 4,
	adjustments,
	record: { caseId: "front-smile", frameIndex: 2 },
};

export function makeCandidateReport({
	inputFrame = input,
	candidateFrame = candidate,
}: {
	inputFrame?: BeautyLabFrame;
	candidateFrame?: BeautyLabFrame;
} = {}): BeautyLabCandidateResult {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		source: "live-candidate",
		backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
		backendVersion: "test-only-stub-v1",
		requestId: "test-only-request",
		requestFingerprint: createHash("sha256")
			.update("test-only-request")
			.digest("hex"),
		inputSha256: createHash("sha256").update(inputFrame.rgba).digest("hex"),
		sourceKey: "beauty-lab:test-only-source",
		frameNumber: 7,
		timestampSeconds: 13.75,
		width: candidateFrame.width,
		height: candidateFrame.height,
		rgba: candidateFrame.rgba.slice(),
		nativeDependencies: ["effect-rendering"],
		stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id, index) => ({
			id,
			durationMs: index + 0.5,
		})),
	};
}

interface ComparisonManifest {
	schema: string;
	createdAt: string;
	inputName: string;
	width: number;
	height: number;
	gain: number;
	adjustments: MediaPortraitAdjustments;
	mode: string;
	record: { caseId: string; frameIndex: number } | null;
	nativeDependencies: boolean;
	nativeResultPresent: boolean;
	candidateResultPresent: boolean;
	arbitraryFrameCandidateReady: boolean;
	staticAuditReady?: boolean;
	candidateProvenance: Omit<BeautyLabCandidateResult, "rgba"> | null;
	comparisons: {
		name: string;
		changedPixels: number;
		pixelCount: number;
		rgbMae: number;
		rgbMax: number;
		alphaMax: number;
	}[];
}

export async function openArchive({ blob }: { blob: Blob }) {
	return JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()), {
		checkCRC32: true,
	});
}

export async function readManifest({
	zip,
}: {
	zip: JSZip;
}): Promise<ComparisonManifest> {
	const file = zip.file("comparison.json");
	if (!file) throw new Error("Missing comparison.json");
	return JSON.parse(await file.async("string")) as ComparisonManifest;
}

/** Replaces canvas encoding and Web Crypto with deterministic stubs for one test. */
export function installExportCanvasStubs() {
	draws.length = 0;
	canvases.clear();
	createImageData.mockClear();
	vi.stubGlobal("Blob", NodeBlob);
	vi.stubGlobal("crypto", webcrypto);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		getCanvasContext
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
		(callback, type) => {
			expect(type).toBe("image/png");
			callback(new Blob([PNG_BYTES], { type: "image/png" }));
		}
	);
}
