import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	createTestProject,
	getMainWindow,
	importTestVideo,
	navigateToProjects,
	startElectronApp,
} from "./helpers/electron-helpers";

interface FixtureElement {
	id: string;
	type: string;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	[key: string]: unknown;
}
interface FixtureTrack {
	id: string;
	type: string;
	isMain?: boolean;
	elements: FixtureElement[];
	[key: string]: unknown;
}
interface NavigationWindow extends Window {
	__timelineStore: {
		getState: () => { _tracks: FixtureTrack[] };
		setState: (value: {
			_tracks: FixtureTrack[];
			tracks: FixtureTrack[];
			selectedElements: [];
		}) => void;
	};
	__mediaStore: { getState: () => { mediaItems: Array<{ id: string }> } };
	__playbackStore: {
		getState: () => { previewScrubTime: number | null; currentTime: number };
	};
}

test("dense timeline hover and zoom stay bounded without changing the playhead", async () => {
	test.setTimeout(180_000);
	const baseline = process.env.QCUT_TIMELINE_PERF_BASELINE === "1";
	const output = path.resolve(
		"output/playwright/timeline-navigation",
		baseline ? "before" : "after"
	);
	await mkdir(output, { recursive: true });
	const app = await startElectronApp({
		userDataDirectory: await mkdtemp(
			path.join(os.tmpdir(), "qcut-navigation-")
		),
	});
	const page = await getMainWindow(app);
	await page.setViewportSize({ width: 1920, height: 1018 });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await navigateToProjects(page);
		await createTestProject(page, "Timeline navigation performance");
		await importTestVideo(page);
		await page.evaluate(() => {
			const harness = window as unknown as NavigationWindow;
			const track = harness.__timelineStore
				.getState()
				._tracks.find((item) => item.isMain || item.type === "media");
			const media = harness.__mediaStore.getState().mediaItems[0];
			if (!track || !media)
				throw new Error("Expected imported video and main track");
			const tracks: FixtureTrack[] = [
				{
					...track,
					elements: Array.from({ length: 600 }, (_, index) => ({
						id: `nav-media-${index}`,
						type: "media",
						name: `Clip ${index}`,
						mediaId: media.id,
						startTime: index * 2,
						duration: 1.8,
						trimStart: 0,
						trimEnd: 0,
					})),
				},
				{
					id: "nav-captions",
					type: "captions",
					name: "Captions",
					elements: Array.from({ length: 1200 }, (_, index) => ({
						id: `nav-caption-${index}`,
						type: "captions",
						name: `Caption ${index}`,
						text: `Caption ${index}`,
						language: "en",
						source: "transcription",
						startTime: index,
						duration: 0.8,
						trimStart: 0,
						trimEnd: 0,
					})),
				},
			];
			harness.__timelineStore.setState({
				_tracks: tracks,
				tracks,
				selectedElements: [],
			});
		});
		await expect
			.poll(() => page.getByTestId("timeline-element").count())
			.toBeGreaterThan(0);
		await page.mouse.move(5, 5);

		const hover = await page.evaluate(async () => {
			const playback = (window as unknown as NavigationWindow).__playbackStore;
			const viewport = document.querySelector<HTMLElement>(".timeline-scroll");
			if (!viewport) throw new Error("Missing timeline");
			const rect = viewport.getBoundingClientRect();
			const currentTime = playback.getState().currentTime;
			let previewRequests = 0;
			const listener = (event: Event) => {
				if ((event as CustomEvent<{ scrub?: boolean }>).detail.scrub)
					previewRequests++;
			};
			window.addEventListener("playback-seek", listener);
			const frameGaps: number[] = [];
			let last = performance.now();
			await new Promise<void>((resolve) => {
				let index = 0;
				const move = () => {
					const now = performance.now();
					frameGaps.push(now - last);
					last = now;
					document.dispatchEvent(
						new PointerEvent("pointermove", {
							clientX: rect.left + 30 + ((rect.width - 70) * index) / 59,
							clientY: rect.top + 25,
							buttons: 0,
							pointerType: "mouse",
							bubbles: true,
						})
					);
					index++;
					if (index < 60) requestAnimationFrame(move);
					else resolve();
				};
				requestAnimationFrame(move);
			});
			const movingRequests = previewRequests;
			await new Promise((resolve) => setTimeout(resolve, 200));
			const settled = playback.getState();
			window.removeEventListener("playback-seek", listener);
			return {
				movingRequests,
				totalRequests: previewRequests,
				frameGaps,
				currentTime,
				finalPlayhead: settled.currentTime,
				previewTime: settled.previewScrubTime,
			};
		});
		await page.screenshot({ path: path.join(output, "01-hover-settled.png") });
		await page.mouse.move(5, 5);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as NavigationWindow).__playbackStore.getState()
							.previewScrubTime
				)
			)
			.toBeNull();

		const zoom = await [20, -8, 10, -10, 6, -18].reduce(
			async (pending, steps) => {
				const measurements = await pending;
				const sample = await page
					.locator(".timeline-scroll")
					.evaluate(async (viewport, count) => {
						const start = performance.now();
						for (let index = 0; index < Math.abs(count); index++) {
							viewport.dispatchEvent(
								new WheelEvent("wheel", {
									deltaY: count > 0 ? -1 : 1,
									ctrlKey: true,
									bubbles: true,
									cancelable: true,
								})
							);
						}
						await new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve())
							)
						);
						return {
							steps: count,
							latencyMs: performance.now() - start,
							ticks: document.querySelectorAll(
								"[data-ruler-area] .absolute.top-0.h-4"
							).length,
						};
					}, steps);
				measurements.push(sample);
				return measurements;
			},
			Promise.resolve(
				[] as Array<{ steps: number; latencyMs: number; ticks: number }>
			)
		);
		await page.screenshot({ path: path.join(output, "02-zoom-complete.png") });

		await page.locator(".timeline-scroll").evaluate((viewport) => {
			viewport.scrollLeft = 180000;
		});
		await expect
			.poll(async () =>
				page
					.locator("[data-ruler-area] .absolute.top-0.h-4 span")
					.allTextContents()
			)
			.toContain("1:00:00");
		await page.screenshot({ path: path.join(output, "03-hour-scroll.png") });
		await page.locator(".timeline-scroll").evaluate((viewport) => {
			viewport.scrollLeft = 0;
		});
		await expect
			.poll(async () =>
				page
					.locator("[data-ruler-area] .absolute.top-0.h-4 span")
					.allTextContents()
			)
			.toContain("0s");
		const ruler = page.locator("[data-ruler-area]");
		const bounds = await ruler.boundingBox();
		if (!bounds) throw new Error("Missing ruler bounds");
		await page.mouse.move(bounds.x + 100, bounds.y + 10);
		await page.mouse.down();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as NavigationWindow).__playbackStore.getState()
							.currentTime
				)
			)
			.toBeCloseTo(2, 1);
		await page.mouse.move(bounds.x + 200, bounds.y + 10, { steps: 4 });
		await page.mouse.up();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as NavigationWindow).__playbackStore.getState()
							.currentTime
				)
			)
			.toBeCloseTo(4, 1);
		await page.mouse.move(5, 5);
		await page.screenshot({ path: path.join(output, "04-ruler-drag.png") });
		const report = {
			baseline,
			viewport: page.viewportSize(),
			fixture: { mediaClips: 600, captions: 1200 },
			hover,
			zoom,
			errors,
		};
		await writeFile(
			path.join(output, "metrics.json"),
			JSON.stringify(report, null, 2)
		);
		console.log(JSON.stringify(report));
		expect(hover.previewTime).not.toBeNull();
		expect(hover.finalPlayhead).toBe(hover.currentTime);
		expect(errors).toEqual([]);
		if (!baseline) {
			expect(hover.movingRequests).toBe(0);
			expect(hover.totalRequests).toBe(1);
			for (const sample of zoom) {
				expect(sample.ticks).toBeGreaterThan(0);
				expect(sample.ticks).toBeLessThan(150);
				expect(sample.latencyMs).toBeLessThan(500);
			}
		}
	} finally {
		await app.close();
	}
});
