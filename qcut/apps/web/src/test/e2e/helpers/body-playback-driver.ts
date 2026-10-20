import { expect, type Page } from "@playwright/test";
import { seek } from "./independent-body-video-helpers";

/** Drives the real timeline clock; buffering may temporarily show the Play button. */
export async function drivePreparedBodyPlayback({
	page,
	frames,
	fps,
	beforePlay,
}: {
	page: Page;
	frames: number;
	fps: number;
	beforePlay: () => Promise<void>;
}) {
	await seek({ page, frame: 0, fps });
	await expect(page.getByTestId("effect-playback-canvas")).toHaveAttribute(
		"data-frame",
		"0"
	);
	await beforePlay();
	await page.getByTestId("timeline-play-button").click();
	await expect(page.getByTestId("timeline-pause-button")).toBeVisible();
	await expect
		.poll(
			() =>
				page.evaluate(
					({ lastFrame, fps }) => {
						const state = (
							window as unknown as {
								__playbackStore: {
									getState: () => { isPlaying: boolean; currentTime: number };
								};
							}
						).__playbackStore.getState();
						const canvas = document.querySelector<HTMLCanvasElement>(
							'[data-testid="effect-playback-canvas"]'
						);
						return (
							!state.isPlaying &&
							Number(canvas?.dataset.frame) === lastFrame &&
							state.currentTime >= lastFrame / fps - 0.001
						);
					},
					{ lastFrame: frames - 1, fps }
				),
			{ timeout: Math.max(30_000, (frames / fps) * 3000), intervals: [100] }
		)
		.toBe(true);
}
