import path from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import {
	armBodyPlaybackEvidence,
	finishBodyPlaybackEvidence,
} from "./body-playback-evidence";
import { readBodyPlaybackResources } from "./body-playback-resource-probe";
import { driveSegmentedRange } from "./body-segmented-playback-driver";
import {
	captureSegmentedFrame,
	expectSegmentedWindow,
	inspectSegmentedCache,
	waitForSegmentedFrame,
} from "./body-segmented-playback-evidence";
import { readSegmentedRequests } from "./body-segmented-playback-requests";
import type { BodyOperationFrame } from "./body-video-operation-evidence";
import { seek } from "./independent-body-video-helpers";
import type { CompositeEvidenceWindow } from "./portrait-composite-project";

/** This translation-invariance check deliberately excludes timeline-time effects. */
export async function verifyMinuteBodyTimeline({
	app,
	page,
	output,
	userDataDirectory,
	baseline,
	evidence,
}: {
	app: ElectronApplication;
	page: Page;
	output: string;
	userDataDirectory: string;
	baseline: BodyOperationFrame[];
	evidence: Record<string, unknown>;
}) {
	expect(baseline).toHaveLength(720);
	const playbackStatus = page.getByTestId("effect-playback-status");
	if ((await playbackStatus.getAttribute("data-status")) !== "idle")
		await page.getByTestId("cancel-effect-playback").click();
	await expect(playbackStatus).toHaveAttribute("data-status", "idle");
	await expect(page.getByTestId("effect-playback-canvas")).toHaveCount(0);
	const project = await page.evaluate(() => {
		const stores = window as unknown as CompositeEvidenceWindow;
		const timeline = stores.__timelineStore.getState();
		const track = timeline.tracks.find((item) =>
			item.elements.some((element) => element.type === "media")
		);
		const originals = track?.elements.filter(
			(element) => element.type === "media"
		);
		if (!track || originals?.length !== 2)
			throw new Error("Minute scenario requires the verified A/B pair");
		if (timeline.getTotalDuration() !== 24)
			throw new Error("Minute scenario requires the 24s reference");
		const restored = originals.map((element, index) => {
			if (element.type !== "media" || !element.portraitAdjustments)
				throw new Error("Missing baseline body clip");
			if (
				element.keyframes ||
				element.crop ||
				(element.playbackRate ?? 1) !== 1 ||
				element.speedKeyframes?.length ||
				element.reverse ||
				(element.animationInType && element.animationInType !== "none") ||
				(element.animationOutType && element.animationOutType !== "none") ||
				(element.comboAnimationType && element.comboAnimationType !== "none")
			)
				throw new Error(
					"Minute mapping does not support animated, cropped or retimed clips"
				);
			const portraitAdjustments = {
				...element.portraitAdjustments,
				values: {
					body_adjust_SlimBody: index === 0 ? 40 : 55,
					body_adjust_StretchLeg: index === 0 ? 30 : 20,
				},
			};
			timeline.updateMediaElement(track.id, element.id, {
				portraitAdjustments,
			});
			return { ...element, portraitAdjustments };
		});
		const ids = restored.map((element) => element.id);
		for (const pair of [1, 2]) {
			for (const element of restored) {
				const id = timeline.addElementToTrack(track.id, {
					type: "media",
					mediaId: element.mediaId,
					name: `${element.name} copy ${pair}`,
					duration: element.duration,
					startTime: element.startTime + pair * 24,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
				});
				if (!id) throw new Error("Cannot extend minute timeline");
				timeline.updateMediaElement(track.id, id, {
					fitMode: element.fitMode,
					portraitAdjustments: element.portraitAdjustments,
				});
				ids.push(id);
			}
		}
		timeline.setSelectedElements([]);
		return {
			ids,
			duration: stores.__timelineStore.getState().getTotalDuration(),
			clips: stores.__timelineStore
				.getState()
				.tracks.flatMap((item) => item.elements)
				.filter((element) => element.type === "media"),
		};
	});
	expect(project.duration).toBe(72);
	expect(new Set(project.ids).size).toBe(6);
	const reference = Array.from({ length: 2160 }, (_, frame) => ({
		frame,
		rgbaSha256: baseline[frame % 720].rgbaSha256,
	}));
	const results: Array<Record<string, unknown>> = [];
	evidence.minuteTimeline = {
		scope:
			"72s six-clip timeline sampled near 24s, 48s and 70s. No full 72s export, full-frame coverage, uninterrupted realtime or single-shot tracking claim.",
		referenceMapping:
			"absoluteFrame % 720; same static smart-body values, source trims and clip-local history",
		project,
		results,
	};
	const before = (await readSegmentedRequests({ app })).length;
	await seek({ page, frame: 717, fps: 30 });
	await page.getByTestId("prepare-effect-playback").click();
	const prepared = await waitForSegmentedFrame({
		page,
		frame: 717,
		settled: true,
	});
	if (!prepared.generation)
		throw new Error("Missing minute timeline generation");
	const generation = prepared.generation;
	expectSegmentedWindow({ status: prepared, total: 2160 });
	expect(prepared.completed).toBeLessThan(2160);
	await [720, 1440, 2100].reduce(async (previous, boundary) => {
		await previous;
		const start = boundary - 3;
		await seek({ page, frame: start, fps: 30 });
		const status = await waitForSegmentedFrame({
			page,
			frame: start,
			generation,
			settled: true,
		});
		expectSegmentedWindow({ status, total: 2160 });
		const cache = await inspectSegmentedCache({
			page,
			status,
			start,
			end: boundary + 4,
			reference,
		});
		await armBodyPlaybackEvidence({ page, stage: `minute-${boundary}` });
		const playback = await driveSegmentedRange({
			page,
			stopFrame: boundary + 3,
			totalFrames: 2160,
		});
		const capture = await finishBodyPlaybackEvidence({ page });
		expect(capture.errors).toEqual([]);
		expect(capture.frames.some((item) => item.frame < boundary)).toBe(true);
		expect(capture.frames.some((item) => item.frame >= boundary)).toBe(true);
		for (const item of capture.frames) {
			expect(item.generation).toBe(generation);
			expect(item.width).toBe(1080);
			expect(item.height).toBe(1920);
			expect(item.bufferedFrames).toBeLessThanOrEqual(6);
			expect(item.bufferedBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
			expect(
				item.rgbaSha256,
				`Minute frame ${item.frame}, reference ${item.frame % 720}`
			).toBe(reference[item.frame].rgbaSha256);
		}
		const presented = await captureSegmentedFrame({
			page,
			output,
			stage: "minute-paused",
			frame: playback.end,
			generation,
			reference,
		});
		results.push({
			boundary,
			status,
			cache,
			playback,
			capture,
			presented,
			resources: await readBodyPlaybackResources({
				app,
				page,
				userDataDirectory,
				label: `minute-${boundary}`,
			}),
		});
	}, Promise.resolve());
	await page.screenshot({ path: path.join(output, "minute-70s-ui.png") });
	await page.getByTestId("cancel-effect-playback").click();
	await expect
		.poll(
			async () => {
				const snapshot = await readBodyPlaybackResources({
					app,
					page,
					userDataDirectory,
					label: "minute-cleanup",
				});
				return snapshot.opfs.length === 0 && snapshot.bitmap?.live === 0;
			},
			{ timeout: 60_000 }
		)
		.toBe(true);
	return {
		scope:
			"72s six-clip timeline sampled near 24s, 48s and 70s. No full 72s export, full-frame coverage, uninterrupted realtime or single-shot tracking claim.",
		referenceMapping:
			"absoluteFrame % 720; same static smart-body values, source trims and clip-local history",
		project,
		results,
		requests: await readSegmentedRequests({ app, after: before }),
		cleaned: await readBodyPlaybackResources({
			app,
			page,
			userDataDirectory,
			label: "minute-final",
		}),
	};
}
