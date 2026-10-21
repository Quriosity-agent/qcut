import { expect, type Page } from "@playwright/test";
import { drivePreparedBodyPlayback } from "./body-playback-driver";

interface PlaybackTimingFrame {
	frame: number;
	generation: string;
	atMs: number;
	isPlaying: boolean;
	bufferedFrames: number;
	bufferedBytes: number;
}

interface PlaybackTimingSnapshot {
	frames: PlaybackTimingFrame[];
	errors: string[];
	elapsedMs: number;
	observationWindowMs: number;
	playbackClockStartObserved: boolean;
	playbackClockEndObserved: boolean;
}

interface PlaybackTimingWindow {
	__bodyPlaybackEvidence?: { stage: string | null };
	__stopBodyPlaybackTiming?: () => PlaybackTimingSnapshot;
	__playbackStore: {
		getState: () => { isPlaying: boolean; currentTime: number };
	};
}

/** Timing has no pixel reads, image encoding, hashes or transport calls while playing. */
export async function measurePreparedBodyPlaybackTiming({
	page,
	frames,
	fps,
}: {
	page: Page;
	frames: number;
	fps: number;
}) {
	let driverError: string | undefined;
	try {
		await drivePreparedBodyPlayback({
			page,
			frames,
			fps,
			beforePlay: () =>
				page.evaluate(
					({ frames, fps }) => {
						const target = window as unknown as PlaybackTimingWindow;
						if (target.__bodyPlaybackEvidence?.stage)
							throw new Error("Full pixel evidence must be idle during timing");
						if (target.__stopBodyPlaybackTiming)
							throw new Error("Playback timing observer already active");
						const observedAt = performance.now();
						let startedAt: number | null = null;
						let endedAt: number | null = null;
						const presented: PlaybackTimingFrame[] = [];
						const errors: string[] = [];
						const onPlay = () => {
							startedAt ??= performance.now();
						};
						const onSeek = () => {
							const state = target.__playbackStore.getState();
							if (
								startedAt !== null &&
								!state.isPlaying &&
								state.currentTime >= (frames - 1) / fps - 0.001
							)
								endedAt = performance.now();
						};
						const onFrame = (event: Event) => {
							const canvas = event.target;
							const detail = (
								event as CustomEvent<{ frame: number; generation: string }>
							).detail;
							if (
								!(canvas instanceof HTMLCanvasElement) ||
								!Number.isInteger(detail?.frame)
							) {
								errors.push("Invalid playback frame timing event");
								return;
							}
							presented.push({
								frame: detail.frame,
								generation: String(detail.generation),
								atMs: performance.now() - observedAt,
								isPlaying: target.__playbackStore.getState().isPlaying,
								bufferedFrames: Number(
									canvas.dataset.bufferedFrames ?? Number.NaN
								),
								bufferedBytes: Number(
									canvas.dataset.bufferedBytes ?? Number.NaN
								),
							});
						};
						window.addEventListener("playback-play", onPlay);
						window.addEventListener("playback-seek", onSeek);
						document.addEventListener(
							"qcut-effect-playback-frame",
							onFrame,
							true
						);
						target.__stopBodyPlaybackTiming = () => {
							window.removeEventListener("playback-play", onPlay);
							window.removeEventListener("playback-seek", onSeek);
							document.removeEventListener(
								"qcut-effect-playback-frame",
								onFrame,
								true
							);
							const now = performance.now();
							return {
								frames: presented,
								errors,
								elapsedMs: (endedAt ?? now) - (startedAt ?? observedAt),
								observationWindowMs: now - observedAt,
								playbackClockStartObserved: startedAt !== null,
								playbackClockEndObserved: endedAt !== null,
							};
						};
					},
					{ frames, fps }
				),
		});
	} catch (error) {
		driverError = error instanceof Error ? error.message : String(error);
	}
	const snapshot = await page.evaluate(() => {
		const target = window as unknown as PlaybackTimingWindow;
		const stop = target.__stopBodyPlaybackTiming;
		if (!stop) throw new Error("Playback timing observer was not installed");
		target.__stopBodyPlaybackTiming = undefined;
		return stop();
	});
	const uniqueFrames = new Set(snapshot.frames.map((frame) => frame.frame))
		.size;
	const playingFrames = snapshot.frames.filter((frame) => frame.isPlaying);
	const gaps = snapshot.frames
		.slice(1)
		.map((frame, index) => frame.atMs - snapshot.frames[index].atMs);
	return {
		...snapshot,
		driverError,
		uniqueFrames,
		coverage: uniqueFrames / frames,
		presentedWhilePlaying: playingFrames.length,
		presentedWhilePaused: snapshot.frames.length - playingFrames.length,
		observedPresentedFps: uniqueFrames / (snapshot.elapsedMs / 1000),
		maximumPresentationGapMs: gaps.length ? Math.max(...gaps) : 0,
		maximumBufferedFrames: Math.max(
			0,
			...snapshot.frames.map((frame) => frame.bufferedFrames)
		),
		maximumBufferedBytes: Math.max(
			0,
			...snapshot.frames.map((frame) => frame.bufferedBytes)
		),
		minimumCoverage: 0.9,
		maximumElapsedMs: (frames / fps) * 1100 + 250,
	};
}

export function expectBodyPlaybackTiming({
	capture,
	generation,
	frames,
}: {
	capture: Awaited<ReturnType<typeof measurePreparedBodyPlaybackTiming>>;
	generation: string;
	frames: number;
}) {
	expect(capture.driverError).toBeUndefined();
	expect(capture.errors).toEqual([]);
	expect(capture.playbackClockStartObserved).toBe(true);
	expect(capture.playbackClockEndObserved).toBe(true);
	expect(
		capture.elapsedMs,
		"Playback clock duration including buffering"
	).toBeLessThanOrEqual(capture.maximumElapsedMs);
	expect(
		capture.coverage,
		"Lightweight actual presentation coverage"
	).toBeGreaterThanOrEqual(capture.minimumCoverage);
	expect(capture.maximumBufferedFrames).toBeLessThanOrEqual(6);
	expect(capture.maximumBufferedBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
	for (const frame of capture.frames) {
		expect(frame.generation).toBe(generation);
		expect(frame.frame).toBeGreaterThanOrEqual(0);
		expect(frame.frame).toBeLessThan(frames);
		expect(frame.bufferedFrames).toBeGreaterThanOrEqual(1);
	}
}
