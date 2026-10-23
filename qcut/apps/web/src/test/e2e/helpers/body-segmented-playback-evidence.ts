import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
	armBodyPlaybackEvidence,
	finishBodyPlaybackEvidence,
} from "./body-playback-evidence";
import type { BodyOperationFrame } from "./body-video-operation-evidence";
import { seek } from "./independent-body-video-helpers";
import { driveSegmentedRange } from "./body-segmented-playback-driver";

export async function readSegmentedStatus({ page }: { page: Page }) {
	return page.getByTestId("effect-playback-status").evaluate((node) => {
		const attribute = (name: string) => node.getAttribute(`data-${name}`);
		const number = (name: string) => {
			const value = attribute(name);
			return value === null || value === "" ? Number.NaN : Number(value);
		};
		return {
			status: attribute("status"),
			generation: attribute("generation"),
			sessionId: attribute("session-id"),
			completed: number("completed"),
			total: number("total"),
			segmentFrames: number("segment-frames"),
			windowStart: number("window-start"),
			windowEnd: number("window-end"),
			cacheBytes: number("cache-bytes"),
			cacheBudgetBytes: number("cache-budget-bytes"),
			preparedTotal: number("prepared-total"),
			evictedTotal: number("evicted-total"),
			targetFrame: number("target-frame"),
			preparingSegment: attribute("preparing-segment"),
			renderMs: number("render-ms"),
			encodeMs: number("encode-ms"),
			writeMs: number("write-ms"),
			wallMs: number("wall-ms"),
		};
	});
}

export async function waitForSegmentedFrame({
	page,
	frame,
	generation,
	settled = false,
}: {
	page: Page;
	frame: number;
	generation?: string;
	settled?: boolean;
}) {
	await expect
		.poll(
			async () => {
				const status = await readSegmentedStatus({ page });
				if (status.status === "error")
					throw new Error("Segmented preparation reported an error");
				const ready =
					status.status === "ready" &&
					status.windowStart <= frame &&
					status.windowEnd > frame &&
					(!generation || status.generation === generation) &&
					(!settled || !status.preparingSegment);
				if (!ready) return false;
				const presented = await page.evaluate(
					({ frame, generation }) => {
						const canvas = document.querySelector<HTMLCanvasElement>(
							'[data-testid="effect-playback-canvas"]'
						);
						return (
							Number(canvas?.dataset.frame) === frame &&
							(!generation || canvas?.dataset.generation === generation)
						);
					},
					{ frame, generation }
				);
				if (!presented || !settled) return presented;
				// An already-cached seek can trim asynchronously without preparing a segment.
				return page.evaluate(async (status) => {
					if (!status.sessionId) return false;
					const root = await navigator.storage.getDirectory();
					const parent = await root.getDirectoryHandle("composition-playback");
					const directory = await parent.getDirectoryHandle(status.sessionId);
					const resident: number[] = [];
					for await (const name of directory.keys()) {
						if (!/^\d+\.png$/.test(name)) return false;
						resident.push(Number(name.slice(0, -4)));
					}
					return (
						resident.length === status.completed &&
						resident.every(
							(frame) => frame >= status.windowStart && frame < status.windowEnd
						)
					);
				}, status);
			},
			{ timeout: 1_800_000, intervals: [100, 250, 500] }
		)
		.toBe(true);
	const canvas = page.getByTestId("effect-playback-canvas");
	await expect(canvas).toHaveAttribute("data-frame", String(frame));
	if (generation)
		await expect(canvas).toHaveAttribute("data-generation", generation);
	return readSegmentedStatus({ page });
}

export function expectSegmentedWindow({
	status,
	total,
}: {
	status: Awaited<ReturnType<typeof readSegmentedStatus>>;
	total: number;
}) {
	expect(status.total).toBe(total);
	expect(status.segmentFrames).toBeGreaterThan(0);
	expect(status.segmentFrames).toBeLessThanOrEqual(60);
	expect(status.windowStart).toBeGreaterThanOrEqual(0);
	expect(status.windowStart).toBeLessThanOrEqual(status.targetFrame);
	expect(status.windowEnd).toBeGreaterThan(status.targetFrame);
	expect(status.windowEnd).toBeLessThanOrEqual(total);
	expect(status.windowEnd - status.windowStart).toBeLessThanOrEqual(
		3 * status.segmentFrames
	);
	expect(status.completed).toBeLessThanOrEqual(3 * status.segmentFrames);
	expect(status.cacheBytes).toBeGreaterThan(0);
	expect(status.cacheBytes).toBeLessThanOrEqual(status.cacheBudgetBytes);
}

export async function settleSegmentedFrame({
	page,
	frame,
	fps,
	frames,
	generation,
}: {
	page: Page;
	frame: number;
	fps: number;
	frames: number;
	generation: string;
}) {
	await seek({ page, frame, fps });
	const status = await waitForSegmentedFrame({
		page,
		frame,
		generation,
		settled: true,
	});
	expectSegmentedWindow({ status, total: frames });
	return status;
}

/** Audit each segment before another target can evict its PNGs. */
export async function inspectSegmentedSequenceCache({
	page,
	frames,
	fps,
	generation,
	reference,
}: {
	page: Page;
	frames: number;
	fps: number;
	generation: string;
	reference: BodyOperationFrame[];
}) {
	const context = { page, frames, fps, generation };
	const first = await settleSegmentedFrame({ ...context, frame: 0 });
	const segments: Array<{
		status: Awaited<ReturnType<typeof readSegmentedStatus>>;
		cache: Awaited<ReturnType<typeof inspectSegmentedCache>>;
	}> = [];
	await Array.from(
		{ length: Math.ceil(frames / first.segmentFrames) },
		(_, index) => index * first.segmentFrames
	).reduce(async (previous, start) => {
		await previous;
		const status = await settleSegmentedFrame({ ...context, frame: start });
		const cache = await inspectSegmentedCache({
			page,
			status,
			start,
			end: Math.min(frames, start + first.segmentFrames),
			reference,
		});
		segments.push({ status, cache });
	}, Promise.resolve());
	const hashes = segments.flatMap(({ cache }) => cache.hashes);
	expect(hashes.map(({ frame }) => frame)).toEqual(
		Array.from({ length: frames }, (_, frame) => frame)
	);
	return { sessionId: first.sessionId, frames: hashes, segments };
}

/** Reads actual OPFS files; only one inspection bitmap/RGBA copy exists at once. */
export async function inspectSegmentedCache({
	page,
	status,
	start,
	end,
	reference,
}: {
	page: Page;
	status: Awaited<ReturnType<typeof readSegmentedStatus>>;
	start: number;
	end: number;
	reference: BodyOperationFrame[];
}) {
	const sessionId = status.sessionId;
	if (!sessionId || !/^(?:(?:v1|unmanaged)-)?[a-f0-9-]{36}$/i.test(sessionId))
		throw new Error("Missing rolling playback cache identity");
	const result = await page.evaluate(
		async ({ sessionId, start, end }) => {
			const root = await navigator.storage.getDirectory();
			const parent = await root.getDirectoryHandle("composition-playback");
			const directory = await parent.getDirectoryHandle(sessionId);
			const files: Array<{ frame: number; bytes: number }> = [];
			const handles: Array<{ frame: number; handle: FileSystemFileHandle }> =
				[];
			for await (const [name, handle] of directory.entries()) {
				if (handle.kind !== "file" || !/^\d+\.png$/.test(name))
					throw new Error(`Unexpected playback cache entry ${name}`);
				handles.push({
					frame: Number(name.slice(0, -4)),
					handle: handle as FileSystemFileHandle,
				});
			}
			await Promise.all(
				handles.map(async ({ frame, handle }) => {
					files.push({ frame, bytes: (await handle.getFile()).size });
				})
			);
			const canvas = document.createElement("canvas");
			canvas.width = 1080;
			canvas.height = 1920;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("Missing rolling inspection context");
			const hashes: Array<{
				frame: number;
				rgbaSha256: string;
				pngBytes: number;
			}> = [];
			try {
				await Array.from(
					{ length: end - start },
					(_, offset) => start + offset
				).reduce(async (previous, frame) => {
					await previous;
					const blob = await (
						await directory.getFileHandle(`${frame}.png`)
					).getFile();
					const bitmap = await createImageBitmap(blob);
					try {
						if (bitmap.width !== 1080 || bitmap.height !== 1920)
							throw new Error(`Invalid frame ${frame} dimensions`);
						context.clearRect(0, 0, 1080, 1920);
						context.drawImage(bitmap, 0, 0);
						const rgba = context.getImageData(0, 0, 1080, 1920).data;
						const digest = await crypto.subtle.digest("SHA-256", rgba);
						hashes.push({
							frame,
							pngBytes: blob.size,
							rgbaSha256: Array.from(new Uint8Array(digest), (byte) =>
								byte.toString(16).padStart(2, "0")
							).join(""),
						});
					} finally {
						bitmap.close();
					}
				}, Promise.resolve());
			} finally {
				canvas.width = 0;
				canvas.height = 0;
			}
			return {
				sessionId,
				files: files.sort((a, b) => a.frame - b.frame),
				bytes: files.reduce((sum, file) => sum + file.bytes, 0),
				hashes,
			};
		},
		{ sessionId, start, end }
	);
	expect(result.files.length).toBe(status.completed);
	expect(result.bytes).toBe(status.cacheBytes);
	expect(result.bytes).toBeLessThanOrEqual(status.cacheBudgetBytes);
	for (const file of result.files) {
		expect(file.frame).toBeGreaterThanOrEqual(status.windowStart);
		expect(file.frame).toBeLessThan(status.windowEnd);
	}
	expect(result.hashes).toHaveLength(end - start);
	for (const entry of result.hashes)
		expect(entry.rgbaSha256, `Rolling PNG frame ${entry.frame}`).toBe(
			reference[entry.frame].rgbaSha256
		);
	return result;
}

export async function captureSegmentedFrame({
	page,
	output,
	stage,
	frame,
	generation,
	reference,
}: {
	page: Page;
	output: string;
	stage: string;
	frame: number;
	generation: string;
	reference: BodyOperationFrame[];
}) {
	await waitForSegmentedFrame({ page, frame, generation });
	const captured = await page
		.getByTestId("effect-playback-canvas")
		.evaluate(async (node) => {
			const canvas = node as HTMLCanvasElement;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Missing presented rolling canvas");
			const frame = Number(canvas.dataset.frame);
			const generation = canvas.dataset.generation;
			const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const png = canvas.toDataURL("image/png");
			const digest = await crypto.subtle.digest("SHA-256", rgba);
			return {
				frame,
				generation,
				width: canvas.width,
				height: canvas.height,
				rgbaSha256: Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, "0")
				).join(""),
				png,
			};
		});
	expect(captured).toMatchObject({
		frame,
		generation,
		width: 1080,
		height: 1920,
		rgbaSha256: reference[frame].rgbaSha256,
	});
	await mkdir(path.join(output, stage), { recursive: true });
	const file = path.join(
		stage,
		`preview-${String(frame).padStart(6, "0")}.png`
	);
	await writeFile(
		path.join(output, file),
		Buffer.from(captured.png.split(",")[1], "base64")
	);
	const { png: _png, ...metadata } = captured;
	return { ...metadata, file };
}

/** Diagnostic pauses inspect the next window before its PNGs can be evicted. */
export async function playSegmentedBody({
	page,
	frames,
	fps,
	generation,
	reference,
	onWindow,
}: {
	page: Page;
	frames: number;
	fps: number;
	generation: string;
	reference: BodyOperationFrame[];
	onWindow: (input: {
		status: Awaited<ReturnType<typeof readSegmentedStatus>>;
		frame: number;
	}) => Promise<void>;
}) {
	await seek({ page, frame: 0, fps });
	const initial = await waitForSegmentedFrame({
		page,
		frame: 0,
		generation,
		settled: true,
	});
	const checkpoints = Array.from(
		{ length: Math.ceil(frames / initial.segmentFrames) },
		(_, index) => Math.min(frames - 1, (index + 1) * initial.segmentFrames + 1)
	);
	const uniqueCheckpoints = [...new Set(checkpoints)];
	const legs: Array<{ start: number; end: number; milliseconds: number }> = [];
	let current = 0;
	const started = Date.now();
	await armBodyPlaybackEvidence({ page, stage: "continuous", frames, fps });
	await uniqueCheckpoints.reduce(async (previous, stopFrame) => {
		await previous;
		const status = await waitForSegmentedFrame({
			page,
			frame: current,
			generation,
			settled: true,
		});
		await onWindow({ status, frame: current });
		const leg = await driveSegmentedRange({
			page,
			stopFrame,
			totalFrames: frames,
		});
		legs.push({ start: current, ...leg });
		current = leg.end;
	}, Promise.resolve());
	const playbackWallMs = Date.now() - started;
	const capture = await finishBodyPlaybackEvidence({ page });
	expect(capture.errors).toEqual([]);
	expect(capture.playbackClockStartObserved).toBe(true);
	expect(current).toBe(frames - 1);
	const unique = new Set(capture.frames.map((item) => item.frame));
	expect(
		unique.size,
		"Presented coverage including buffer-resume draws"
	).toBeGreaterThanOrEqual(Math.ceil(frames * 0.8));
	for (const item of capture.frames) {
		expect(item.generation).toBe(generation);
		expect(item.width).toBe(1080);
		expect(item.height).toBe(1920);
		expect(item.bufferedFrames).toBeLessThanOrEqual(6);
		expect(item.bufferedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
		expect(item.rgbaSha256, `Presented frame ${item.frame}`).toBe(
			reference[item.frame].rgbaSha256
		);
	}
	for (
		let boundary = initial.segmentFrames;
		boundary < frames;
		boundary += initial.segmentFrames
	) {
		expect(
			legs.some((leg) => leg.start < boundary && leg.end >= boundary),
			`Playback crosses ${boundary}`
		).toBe(true);
		expect(
			capture.frames.some(
				(item) => item.frame >= boundary - 3 && item.frame < boundary
			)
		).toBe(true);
		expect(
			capture.frames.some(
				(item) => item.frame >= boundary && item.frame <= boundary + 3
			)
		).toBe(true);
	}
	return {
		...capture,
		legs,
		playbackWallMs,
		scope:
			"Real playback crosses every segment boundary; diagnostic pauses inspect future PNGs. Wall time includes preparation, inspection and buffering.",
		uniquePresented: unique.size,
		coverage: unique.size / frames,
		playbackLegWallMs: legs.reduce((sum, leg) => sum + leg.milliseconds, 0),
	};
}
