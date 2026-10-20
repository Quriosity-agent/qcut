import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { BodyOperationFrame } from "./body-video-operation-evidence";
import { drivePreparedBodyPlayback } from "./body-playback-driver";

export interface BodyPlaybackFrame {
	sequence: number;
	frame: number;
	generation: string;
	atMs: number;
	isPlaying: boolean;
	width: number;
	height: number;
	bufferedFrames: number;
	bufferedBytes: number;
	rgbaSha256: string;
	png?: string;
}

interface PlaybackEvidenceState {
	stage: string | null;
	sequence: number;
	startedAt: number;
	pending: Set<Promise<void>>;
	errors: string[];
	frames: BodyPlaybackFrame[];
	maximumPending: number;
	samples: Array<{ frame: BodyPlaybackFrame; rgba: Uint8ClampedArray }>;
	playbackStartedAt: number | null;
	playbackEndedAt: number | null;
	lastTime: number | null;
}

interface PlaybackEvidenceWindow {
	__bodyPlaybackEvidence?: PlaybackEvidenceState;
	__saveBodyPlaybackFrame: (
		input: BodyPlaybackFrame & { stage: string; dataUrl?: string }
	) => Promise<void>;
	__playbackStore: {
		getState: () => { isPlaying: boolean; currentTime: number };
	};
}

export async function installBodyPlaybackEvidence({
	page,
	output,
	stages,
}: {
	page: Page;
	output: string;
	stages: Record<string, BodyPlaybackFrame[]>;
}) {
	await page.exposeFunction(
		"__saveBodyPlaybackFrame",
		async ({
			stage,
			dataUrl,
			...frame
		}: BodyPlaybackFrame & {
			stage: string;
			dataUrl?: string;
		}) => {
			if (!/^[a-z0-9-]+$/.test(stage))
				throw new Error("Invalid playback evidence stage");
			const png = dataUrl
				? path.join(
						stage,
						`playback-${String(frame.sequence).padStart(6, "0")}.png`
					)
				: undefined;
			if (png && dataUrl) {
				if (!dataUrl.startsWith("data:image/png;base64,"))
					throw new Error("Expected playback PNG evidence");
				await mkdir(path.join(output, stage), { recursive: true });
				await writeFile(
					path.join(output, png),
					Buffer.from(dataUrl.split(",")[1], "base64")
				);
			}
			stages[stage] ??= [];
			const existing = stages[stage].find(
				(candidate) => candidate.sequence === frame.sequence
			);
			if (existing) {
				if (png) existing.png = png;
				return;
			}
			stages[stage].push({ ...frame, ...(png ? { png } : {}) });
		}
	);
	await page.evaluate(() => {
		const target = window as unknown as PlaybackEvidenceWindow;
		if (target.__bodyPlaybackEvidence)
			throw new Error("Playback evidence observer already installed");
		const state: PlaybackEvidenceState = {
			stage: null,
			sequence: 0,
			startedAt: 0,
			pending: new Set(),
			errors: [],
			frames: [],
			maximumPending: 0,
			samples: [],
			playbackStartedAt: null,
			playbackEndedAt: null,
			lastTime: null,
		};
		target.__bodyPlaybackEvidence = state;
		window.addEventListener("playback-play", () => {
			if (state.stage && state.playbackStartedAt === null)
				state.playbackStartedAt = performance.now();
		});
		window.addEventListener("playback-seek", () => {
			const playback = target.__playbackStore.getState();
			if (
				state.stage &&
				state.playbackStartedAt !== null &&
				state.lastTime !== null &&
				!playback.isPlaying &&
				playback.currentTime >= state.lastTime - 0.001
			)
				state.playbackEndedAt = performance.now();
		});
		document.addEventListener(
			"qcut-effect-playback-frame",
			(event) => {
				const stage = state.stage;
				if (!stage) return;
				const canvas = event.target;
				if (!(canvas instanceof HTMLCanvasElement)) {
					state.errors.push("Playback event target is not a canvas");
					return;
				}
				const detail = (
					event as CustomEvent<{ frame: number; generation: string | number }>
				).detail;
				if (!detail || !Number.isInteger(detail.frame) || detail.frame < 0) {
					state.errors.push("Invalid presented playback frame");
					return;
				}
				if (state.pending.size >= 8) {
					state.errors.push(
						"Playback evidence exceeded eight pending pixel copies"
					);
					return;
				}
				const context = canvas.getContext("2d");
				if (!context) {
					state.errors.push("Missing presented playback canvas context");
					return;
				}
				// Copy inside the post-draw event; an async read could capture the next frame.
				const rgba = context.getImageData(
					0,
					0,
					canvas.width,
					canvas.height
				).data;
				const sequence = state.sequence++;
				const snapshot = {
					sequence,
					frame: detail.frame,
					generation: String(detail.generation),
					atMs: performance.now() - state.startedAt,
					isPlaying: target.__playbackStore.getState().isPlaying,
					width: canvas.width,
					height: canvas.height,
					bufferedFrames: Number(canvas.dataset.bufferedFrames ?? Number.NaN),
					bufferedBytes: Number(canvas.dataset.bufferedBytes ?? Number.NaN),
				};
				const pending = crypto.subtle
					.digest("SHA-256", rgba)
					.then(async (digest) => {
						const frame: BodyPlaybackFrame = {
							...snapshot,
							rgbaSha256: Array.from(new Uint8Array(digest), (byte) =>
								byte.toString(16).padStart(2, "0")
							).join(""),
						};
						state.frames.push(frame);
						if (sequence < 3) state.samples.push({ frame, rgba });
						await target.__saveBodyPlaybackFrame({ ...frame, stage });
					})
					.catch((error: unknown) => {
						state.errors.push(
							error instanceof Error ? error.message : String(error)
						);
					});
				state.pending.add(pending);
				state.maximumPending = Math.max(
					state.maximumPending,
					state.pending.size
				);
				void pending.finally(() => state.pending.delete(pending));
			},
			true
		);
	});
}

export async function armBodyPlaybackEvidence({
	page,
	stage,
	frames,
	fps,
}: {
	page: Page;
	stage: string;
	frames?: number;
	fps?: number;
}) {
	await page.evaluate(
		async ({ stage, frames, fps }) => {
			const state = (window as unknown as PlaybackEvidenceWindow)
				.__bodyPlaybackEvidence;
			if (!state) throw new Error("Missing playback evidence observer");
			await Promise.all(state.pending);
			state.stage = stage;
			state.sequence = 0;
			state.startedAt = performance.now();
			state.errors = [];
			state.frames = [];
			state.maximumPending = 0;
			state.samples = [];
			state.playbackStartedAt = null;
			state.playbackEndedAt = null;
			state.lastTime =
				frames !== undefined && fps !== undefined ? (frames - 1) / fps : null;
		},
		{ stage, frames, fps }
	);
}

export async function finishBodyPlaybackEvidence({ page }: { page: Page }) {
	return page.evaluate(async () => {
		const target = window as unknown as PlaybackEvidenceWindow;
		const state = target.__bodyPlaybackEvidence;
		if (!state) throw new Error("Missing playback evidence observer");
		const stage = state.stage;
		const finishedAt = performance.now();
		state.stage = null;
		await Promise.all(state.pending);
		const retainedSampleBytes = state.samples.reduce(
			(total, sample) => total + sample.rgba.byteLength,
			0
		);
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		try {
			if (!context || !stage) throw new Error("Missing playback sample target");
			// PNG encoding runs after the playback clock stops; only three RGBA samples survive.
			await state.samples.reduce(async (previous, sample) => {
				await previous;
				canvas.width = sample.frame.width;
				canvas.height = sample.frame.height;
				const image = context.createImageData(canvas.width, canvas.height);
				image.data.set(sample.rgba);
				context.putImageData(image, 0, 0);
				await target.__saveBodyPlaybackFrame({
					...sample.frame,
					stage,
					dataUrl: canvas.toDataURL("image/png"),
				});
			}, Promise.resolve());
		} finally {
			state.samples = [];
			canvas.width = 0;
			canvas.height = 0;
		}
		return {
			errors: state.errors,
			maximumPending: state.maximumPending,
			frames: state.frames.sort(
				(left, right) => left.sequence - right.sequence
			),
			elapsedMs:
				(state.playbackEndedAt ?? finishedAt) -
				(state.playbackStartedAt ?? state.startedAt),
			observationWindowMs: finishedAt - state.startedAt,
			evidenceFlushMs: performance.now() - finishedAt,
			retainedSampleBytes,
			playbackClockStartObserved: state.playbackStartedAt !== null,
			playbackClockEndObserved: state.playbackEndedAt !== null,
		};
	});
}

export async function waitForEffectPlaybackReady({ page }: { page: Page }) {
	const status = page.getByTestId("effect-playback-status");
	await expect(status).toHaveAttribute("data-status", "ready", {
		timeout: 900_000,
	});
	const generation = await status.getAttribute("data-generation");
	if (!generation) throw new Error("Ready playback has no generation");
	return generation;
}

export async function playPreparedBodyClip({
	page,
	stage,
	frames,
	fps,
}: {
	page: Page;
	stage: string;
	frames: number;
	fps: number;
}) {
	await drivePreparedBodyPlayback({
		page,
		frames,
		fps,
		beforePlay: () => armBodyPlaybackEvidence({ page, stage, frames, fps }),
	});
	return finishBodyPlaybackEvidence({ page });
}

export function expectPlaybackPixels({
	capture,
	reference,
	generation,
	frames,
	fps,
	minimumCoverage = 0.8,
	maximumBufferedFrames = 6,
}: {
	capture: Awaited<ReturnType<typeof finishBodyPlaybackEvidence>>;
	reference: BodyOperationFrame[];
	generation: string;
	frames: number;
	fps: number;
	minimumCoverage?: number;
	maximumBufferedFrames?: number;
}) {
	expect(capture.errors).toEqual([]);
	expect(capture.playbackClockStartObserved).toBe(true);
	expect(capture.playbackClockEndObserved).toBe(true);
	expect(reference).toHaveLength(frames);
	expect(
		capture.elapsedMs,
		"Prepared playback must finish near normal speed"
	).toBeLessThanOrEqual((frames / fps) * 1500 + 1000);
	const playing = capture.frames.filter((frame) => frame.isPlaying);
	const unique = new Set(playing.map((frame) => frame.frame));
	expect(
		unique.size,
		"Presented-frame coverage at normal speed"
	).toBeGreaterThanOrEqual(Math.ceil(frames * minimumCoverage));
	for (const frame of capture.frames) {
		expect(frame.generation).toBe(generation);
		expect(frame.width).toBe(1080);
		expect(frame.height).toBe(1920);
		expect(frame.frame).toBeGreaterThanOrEqual(0);
		expect(frame.frame).toBeLessThan(frames);
		expect(frame.rgbaSha256, `Presented frame ${frame.frame}`).toBe(
			reference[frame.frame].rgbaSha256
		);
		expect(frame.bufferedFrames).toBeGreaterThanOrEqual(1);
		expect(frame.bufferedFrames).toBeLessThanOrEqual(maximumBufferedFrames);
		expect(frame.bufferedBytes).toBeGreaterThanOrEqual(1080 * 1920 * 4);
		expect(frame.bufferedBytes).toBeLessThanOrEqual(
			maximumBufferedFrames * 1080 * 1920 * 4
		);
	}
	return {
		presentedFrames: playing.length,
		uniqueFrames: unique.size,
		coverage: unique.size / frames,
		minimumCoverage,
		observedPresentedFps: unique.size / (capture.elapsedMs / 1000),
		nominalFps: fps,
		elapsedMs: capture.elapsedMs,
		maximumBufferedFrames: Math.max(
			...capture.frames.map((frame) => frame.bufferedFrames)
		),
		maximumBufferedBytes: Math.max(
			...capture.frames.map((frame) => frame.bufferedBytes)
		),
		maximumPendingEvidenceCopies: capture.maximumPending,
		retainedSampleBytes: capture.retainedSampleBytes,
		evidenceFlushMs: capture.evidenceFlushMs,
		observationWindowMs: capture.observationWindowMs,
	};
}
