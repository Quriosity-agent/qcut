import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { ExportFrameEvidenceSink } from "../../../lib/export/export-frame-evidence";
import { seek, waitForPausedFrame } from "./independent-body-video-helpers";

export interface BodyOperationFrame {
	frame: number;
	rgbaSha256: string;
	png?: string;
}

interface OperationEvidenceWindow {
	__qcutExportFrameEvidence?: ExportFrameEvidenceSink;
	__saveBodyOperationFrame: (
		input: BodyOperationFrame & { stage: string; dataUrl?: string }
	) => Promise<void>;
}

export async function installBodyOperationEvidence({
	page,
	output,
	stages,
}: {
	page: Page;
	output: string;
	stages: Record<string, BodyOperationFrame[]>;
}) {
	await page.exposeFunction(
		"__saveBodyOperationFrame",
		async ({
			stage,
			frame,
			rgbaSha256,
			dataUrl,
		}: BodyOperationFrame & { stage: string; dataUrl?: string }) => {
			if (
				!/^[a-z0-9-]+$/.test(stage) ||
				!Number.isInteger(frame) ||
				frame < 0 ||
				!/^[a-f0-9]{64}$/.test(rgbaSha256)
			)
				throw new Error("Invalid body operation frame evidence");
			stages[stage] ??= [];
			const frames = stages[stage];
			if (frames.length !== frame)
				throw new Error(
					`Nonsequential evidence in ${stage}: ${frame} after ${frames.length}`
				);
			const png = dataUrl
				? path.join(stage, `export-frame-${String(frame).padStart(6, "0")}.png`)
				: undefined;
			if (png && dataUrl) {
				if (!dataUrl.startsWith("data:image/png;base64,"))
					throw new Error("Expected PNG evidence");
				await mkdir(path.join(output, stage), { recursive: true });
				await writeFile(
					path.join(output, png),
					Buffer.from(dataUrl.split(",")[1], "base64")
				);
			}
			frames.push({ frame, rgbaSha256, ...(png ? { png } : {}) });
		}
	);
}

export async function armBodyOperationEvidence({
	page,
	stage,
	frames,
	samples,
}: {
	page: Page;
	stage: string;
	frames: number;
	samples: number[];
}) {
	await page.evaluate(
		({ stage, frames, samples }) => {
			const target = window as unknown as OperationEvidenceWindow;
			const sink: ExportFrameEvidenceSink = {
				// One next index stays within the production sink's 32-index budget.
				frameIndices: [0],
				capture: async ({ canvas, frameIndex }) => {
					if (canvas.width !== 1080 || canvas.height !== 1920)
						throw new Error("Body export evidence must be 1080p portrait");
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Missing export canvas context");
					const rgba = context.getImageData(
						0,
						0,
						canvas.width,
						canvas.height
					).data;
					const digest = await crypto.subtle.digest("SHA-256", rgba);
					const rgbaSha256 = Array.from(new Uint8Array(digest), (byte) =>
						byte.toString(16).padStart(2, "0")
					).join("");
					await target.__saveBodyOperationFrame({
						stage,
						frame: frameIndex,
						rgbaSha256,
						...(samples.includes(frameIndex)
							? { dataUrl: canvas.toDataURL("image/png") }
							: {}),
					});
					sink.frameIndices = frameIndex + 1 < frames ? [frameIndex + 1] : [];
				},
			};
			target.__qcutExportFrameEvidence = sink;
		},
		{ stage, frames, samples }
	);
}

export function expectBodyOperationFrames({
	stages,
	actual,
	reference,
	frames,
}: {
	stages: Record<string, BodyOperationFrame[]>;
	actual: string;
	reference: string;
	frames: number;
}) {
	expect(
		stages[actual],
		`${actual} must capture every pre-encode frame`
	).toHaveLength(frames);
	expect(stages[reference]).toHaveLength(frames);
	expect(stages[actual].map(({ rgbaSha256 }) => rgbaSha256)).toEqual(
		stages[reference].map(({ rgbaSha256 }) => rgbaSha256)
	);
}

/** Saves the exact committed composition, independent of CSS scale and H.264 loss. */
export async function captureBodyOperationPreview({
	page,
	output,
	stage,
	frame,
	fps,
	expected,
}: {
	page: Page;
	output: string;
	stage: string;
	frame: number;
	fps: number;
	expected?: string;
}) {
	await seek({ page, frame, fps });
	await waitForPausedFrame({ page, frame, timeout: 300_000 });
	const image = page.locator('[data-canvas-composition-preview="ready"]');
	await expect(image).toHaveAttribute("data-frame", String(frame));
	const capture = await image.evaluate(async (node) => {
		const image = node as HTMLImageElement;
		await image.decode();
		if (image.naturalWidth !== 1080 || image.naturalHeight !== 1920)
			throw new Error("Expected full-resolution composition preview");
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Missing preview evidence canvas");
		context.drawImage(image, 0, 0);
		const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const digest = await crypto.subtle.digest("SHA-256", rgba);
		return {
			dataUrl: canvas.toDataURL("image/png"),
			rgbaSha256: Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, "0")
			).join(""),
		};
	});
	const file = path.join(
		stage,
		`preview-frame-${String(frame).padStart(6, "0")}.png`
	);
	await mkdir(path.join(output, stage), { recursive: true });
	const png = Buffer.from(capture.dataUrl.split(",")[1], "base64");
	await writeFile(path.join(output, file), png);
	if (expected)
		expect(capture.rgbaSha256, `${stage} preview/export frame ${frame}`).toBe(
			expected
		);
	return {
		frame,
		file,
		rgbaSha256: capture.rgbaSha256,
		pngSha256: createHash("sha256").update(png).digest("hex"),
	};
}
