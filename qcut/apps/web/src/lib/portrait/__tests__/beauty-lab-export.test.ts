import { Blob as NodeBlob, Buffer } from "node:buffer";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import type { BeautyLabFrame } from "../beauty-lab-difference";
import { exportBeautyLabComparison } from "../beauty-lab-export";

const PNG_BYTES = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWJ0AAAAASUVORK5CYII=",
		"base64"
	)
);
const draws: { canvas: HTMLCanvasElement; rgba: Uint8ClampedArray }[] = [];
const canvases = new Set<HTMLCanvasElement>();
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

function makeFrame({
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

const input = makeFrame({ name: "../../original-photo.jpg", red: 0 });
const native = makeFrame({ name: "Native renderer", red: 2 });
const candidate = makeFrame({ name: "Verified replay", red: 8 });
const adjustments: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_Smooth: 65 },
	faces: [{ trackId: 2, values: { face_adjust_Smooth: 40 } }],
};
const options = {
	input,
	native,
	candidate,
	gain: 4,
	adjustments,
	record: { caseId: "front-smile", frameIndex: 2 },
};

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
	comparisons: {
		name: string;
		changedPixels: number;
		pixelCount: number;
		rgbMae: number;
		rgbMax: number;
		alphaMax: number;
	}[];
}

async function openArchive({ blob }: { blob: Blob }) {
	return JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()), {
		checkCRC32: true,
	});
}

async function readManifest({
	zip,
}: {
	zip: JSZip;
}): Promise<ComparisonManifest> {
	const file = zip.file("comparison.json");
	if (!file) throw new Error("Missing comparison.json");
	return JSON.parse(await file.async("string")) as ComparisonManifest;
}

beforeEach(() => {
	draws.length = 0;
	canvases.clear();
	createImageData.mockClear();
	vi.stubGlobal("Blob", NodeBlob);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		getCanvasContext
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
		(callback, type) => {
			expect(type).toBe("image/png");
			callback(new Blob([PNG_BYTES], { type: "image/png" }));
		}
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("exportBeautyLabComparison ZIP", () => {
	it("writes a readable real ZIP with the exact schema, record, PNG filenames and raw metrics", async () => {
		const blob = await exportBeautyLabComparison(options);
		expect(blob.type).toBe("application/zip");
		const zip = await openArchive({ blob });
		expect(Object.keys(zip.files).sort()).toEqual([
			"candidate.png",
			"comparison.json",
			"difference-native-candidate.png",
			"difference-original-candidate.png",
			"difference-original-native.png",
			"native.png",
			"original.png",
		]);
		const manifest = await readManifest({ zip });
		expect(manifest).toEqual({
			schema: "qcut-beauty-lab-comparison-v1",
			createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			inputName: input.name,
			width: 1,
			height: 1,
			gain: 4,
			adjustments,
			mode: "verified-offline-replay",
			record: options.record,
			nativeDependencies: true,
			arbitraryFrameCandidateReady: false,
			nativeResultPresent: true,
			candidateResultPresent: true,
			comparisons: [
				{
					name: "original-native",
					changedPixels: 1,
					pixelCount: 1,
					rgbMae: 2 / 3,
					rgbMax: 2,
					alphaMax: 0,
				},
				{
					name: "original-candidate",
					changedPixels: 1,
					pixelCount: 1,
					rgbMae: 8 / 3,
					rgbMax: 8,
					alphaMax: 0,
				},
				{
					name: "native-candidate",
					changedPixels: 1,
					pixelCount: 1,
					rgbMae: 2,
					rgbMax: 6,
					alphaMax: 0,
				},
			],
		});
		expect(Number.isFinite(Date.parse(manifest.createdAt))).toBe(true);
		const encodedPngs = await Promise.all(
			Object.values(zip.files)
				.filter((file) => file.name.endsWith(".png"))
				.map((file) => file.async("uint8array"))
		);
		for (const png of encodedPngs) {
			expect(png).toEqual(PNG_BYTES);
			expect(Array.from(png.slice(0, 8))).toEqual([
				137, 80, 78, 71, 13, 10, 26, 10,
			]);
		}
	});

	it("uses one shared gain for all encoded difference pixels without altering raw metrics", async () => {
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({ ...options, gain: 32 }),
		});
		expect(draws.map(({ rgba }) => Array.from(rgba))).toEqual([
			[0, 0, 0, 255],
			[2, 0, 0, 255],
			[8, 0, 0, 255],
			[64, 64, 64, 255],
			[255, 255, 255, 255],
			[192, 192, 192, 255],
		]);
		const manifest = await readManifest({ zip });
		expect(manifest.gain).toBe(32);
		expect(manifest.comparisons.map(({ rgbMax }) => rgbMax)).toEqual([2, 8, 6]);
	});

	it("exports a missing candidate honestly, without candidate PNGs or zero-difference placeholders", async () => {
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				candidate: null,
				record: null,
			}),
		});
		expect(Object.keys(zip.files).sort()).toEqual([
			"comparison.json",
			"difference-original-native.png",
			"native.png",
			"original.png",
		]);
		const manifest = await readManifest({ zip });
		expect(manifest.mode).toBe("native-live");
		expect(manifest.record).toBeNull();
		expect(manifest.arbitraryFrameCandidateReady).toBe(false);
		expect(manifest.nativeResultPresent).toBe(true);
		expect(manifest.candidateResultPresent).toBe(false);
		expect(manifest.comparisons).toHaveLength(1);
		expect(manifest.comparisons[0].name).toBe("original-native");
		expect(draws).toHaveLength(3);
	});

	it("records an actual native-candidate pixel match independently of input-native changes", async () => {
		const replay = {
			...native,
			name: "Matching replay",
			rgba: native.rgba.slice(),
		};
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({ ...options, candidate: replay }),
		});
		const manifest = await readManifest({ zip });
		expect(manifest.nativeResultPresent).toBe(true);
		expect(manifest.candidateResultPresent).toBe(true);
		expect(
			manifest.comparisons.map(({ changedPixels }) => changedPixels)
		).toEqual([1, 1, 0]);
		expect(manifest.comparisons[2]).toEqual({
			name: "native-candidate",
			changedPixels: 0,
			pixelCount: 1,
			rgbMae: 0,
			rgbMax: 0,
			alphaMax: 0,
		});
		expect(zip.file("difference-native-candidate.png")).not.toBeNull();
		expect(Array.from(draws[5].rgba)).toEqual([0, 0, 0, 255]);
	});

	it("omits missing native pairs and supports an input-only archive without parity metrics", async () => {
		const candidateOnly = await openArchive({
			blob: await exportBeautyLabComparison({ ...options, native: null }),
		});
		expect(Object.keys(candidateOnly.files).sort()).toEqual([
			"candidate.png",
			"comparison.json",
			"difference-original-candidate.png",
			"original.png",
		]);
		expect(
			(await readManifest({ zip: candidateOnly })).comparisons.map(
				({ name }) => name
			)
		).toEqual(["original-candidate"]);
		const originalOnly = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				native: null,
				candidate: null,
				record: null,
			}),
		});
		expect(Object.keys(originalOnly.files).sort()).toEqual([
			"comparison.json",
			"original.png",
		]);
		expect((await readManifest({ zip: originalOnly })).comparisons).toEqual([]);
		expect(await readManifest({ zip: originalOnly })).toMatchObject({
			nativeResultPresent: false,
			candidateResultPresent: false,
		});
	});

	it("records alpha-only changes even when encoded differences have zero RGB", async () => {
		const transparent = makeFrame({ name: "transparent", red: 0, alpha: 0 });
		const opaque = makeFrame({ name: "opaque", red: 0 });
		const zip = await openArchive({
			blob: await exportBeautyLabComparison({
				...options,
				input: transparent,
				native: opaque,
				candidate: null,
			}),
		});
		expect((await readManifest({ zip })).comparisons[0]).toEqual({
			name: "original-native",
			changedPixels: 1,
			pixelCount: 1,
			rgbMae: 0,
			rgbMax: 0,
			alphaMax: 255,
		});
		expect(Array.from(draws[2].rgba)).toEqual([0, 0, 0, 255]);
	});

	it("does not mutate caller pixels, parameters or record metadata", async () => {
		const local = {
			...options,
			input: makeFrame({ name: "source", red: 0 }),
			native: makeFrame({ name: "native", red: 2 }),
			candidate: makeFrame({ name: "candidate", red: 8 }),
			adjustments: structuredClone(adjustments),
			record: { ...options.record },
		};
		const before = {
			input: Array.from(local.input.rgba),
			native: Array.from(local.native.rgba),
			candidate: Array.from(local.candidate.rgba),
			adjustments: JSON.stringify(local.adjustments),
			record: JSON.stringify(local.record),
		};
		await exportBeautyLabComparison(local);
		expect(Array.from(local.input.rgba)).toEqual(before.input);
		expect(Array.from(local.native.rgba)).toEqual(before.native);
		expect(Array.from(local.candidate.rgba)).toEqual(before.candidate);
		expect(JSON.stringify(local.adjustments)).toBe(before.adjustments);
		expect(JSON.stringify(local.record)).toBe(before.record);
	});

	it("rejects mismatched frames without rescaling or encoding a misleading comparison", async () => {
		const mismatched = { ...native, width: 2, rgba: new Uint8Array(8) };
		await expect(
			exportBeautyLabComparison({ ...options, native: mismatched })
		).rejects.toThrow("same dimensions");
		expect(draws).toHaveLength(0);
	});

	it("rejects an invalid input even when there are no comparison partners", async () => {
		await expect(
			exportBeautyLabComparison({
				...options,
				input: { ...input, rgba: new Uint8Array(3) },
				native: null,
				candidate: null,
			})
		).rejects.toThrow("byte count");
		expect(draws).toHaveLength(0);
	});

	it.each([
		{ gain: 0 },
		{ gain: 33 },
		{ gain: 1.5 },
	])("rejects invalid shared gain $gain with populated comparisons", async ({
		gain,
	}) => {
		await expect(
			exportBeautyLabComparison({ ...options, gain })
		).rejects.toThrow("gain");
		expect(draws).toHaveLength(0);
	});

	it.each([
		{ gain: 0 },
		{ gain: 33 },
	])("rejects invalid shared gain $gain even without comparison partners", async ({
		gain,
	}) => {
		await expect(
			exportBeautyLabComparison({
				...options,
				native: null,
				candidate: null,
				gain,
			})
		).rejects.toThrow("gain");
	});

	it("releases all canvas backing stores after successful PNG encoding", async () => {
		await exportBeautyLabComparison(options);
		expect(canvases.size).toBe(6);
		for (const canvas of canvases) {
			expect(canvas.width).toBe(0);
			expect(canvas.height).toBe(0);
		}
	});

	it("rejects null PNG encodings and releases the backing stores", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => callback(null)
		);
		await expect(exportBeautyLabComparison(options)).rejects.toThrow(
			"PNG encoding failed"
		);
		for (const canvas of canvases) {
			expect(canvas.width).toBe(0);
			expect(canvas.height).toBe(0);
		}
	});

	it("reports unavailable contexts and does not emit a blank PNG archive", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		await expect(exportBeautyLabComparison(options)).rejects.toThrow(
			"Canvas unavailable"
		);
		expect(draws).toHaveLength(0);
	});
});
