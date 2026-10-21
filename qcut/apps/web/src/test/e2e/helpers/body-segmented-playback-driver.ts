import { expect, type Page } from "@playwright/test";
import type { CompositeEvidenceWindow } from "./portrait-composite-project";

interface SegmentedStopWindow extends CompositeEvidenceWindow {
	__segmentedStop?: { reached: boolean; frame: number; cleanup: () => void };
}

/** Stops after a real draw, so a boundary is crossed by playback rather than a seek. */
export async function driveSegmentedRange({
	page,
	stopFrame,
	totalFrames,
}: {
	page: Page;
	stopFrame: number;
	totalFrames: number;
}) {
	await page.evaluate(
		({ stopFrame, lastFrame }) => {
			const target = window as unknown as SegmentedStopWindow;
			target.__segmentedStop?.cleanup();
			const stop = (event: Event) => {
				const frame = (event as CustomEvent<{ frame: number }>).detail.frame;
				if (frame < stopFrame) return;
				state.reached = true;
				state.frame = frame;
				state.cleanup();
				if (stopFrame < lastFrame) target.__playbackStore.getState().pause();
			};
			const state = {
				reached: false,
				frame: -1,
				cleanup: () =>
					document.removeEventListener("qcut-effect-playback-frame", stop),
			};
			target.__segmentedStop = state;
			document.addEventListener("qcut-effect-playback-frame", stop);
		},
		{ stopFrame, lastFrame: totalFrames - 1 }
	);
	const started = Date.now();
	try {
		await page.getByTestId("timeline-play-button").click();
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const target = window as unknown as SegmentedStopWindow;
						return (
							target.__segmentedStop?.reached &&
							!target.__playbackStore.getState().isPlaying
						);
					}),
				{ timeout: 1_800_000, intervals: [100, 250] }
			)
			.toBe(true);
		const end = await page.evaluate(
			() =>
				(window as unknown as SegmentedStopWindow).__segmentedStop?.frame ?? -1
		);
		return { end, milliseconds: Date.now() - started };
	} finally {
		await page.evaluate(() =>
			(window as unknown as SegmentedStopWindow).__segmentedStop?.cleanup()
		);
	}
}
