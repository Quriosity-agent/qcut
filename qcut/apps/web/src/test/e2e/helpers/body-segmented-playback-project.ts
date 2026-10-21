import { expect, type Page } from "@playwright/test";
import type { CompositeEvidenceWindow } from "./portrait-composite-project";
import {
	createTestProject,
	navigateToProjects,
	uploadTestMedia,
} from "./electron-helpers";

export async function prepareSegmentedBodyProject({
	page,
	source,
	seconds,
	engine,
}: {
	page: Page;
	source: string;
	seconds: number;
	engine: "native" | "independent";
}) {
	await page.setViewportSize({ width: 1800, height: 1100 });
	await page.evaluate(() =>
		localStorage.setItem(
			"qcut-app-settings",
			JSON.stringify({
				version: 1,
				state: { autoCanvasFromFirstMedia: false },
			})
		)
	);
	await page.reload();
	await navigateToProjects(page);
	await createTestProject(page, `Segmented ${engine} body ${Date.now()}`);
	await uploadTestMedia(page, source);
	const runtime = await page.evaluate(async (engine) => {
		if (engine === "native") {
			const status =
				await window.electronAPI?.jianyingPortraitAdjustment?.inspect?.();
			if (!status?.available || status.state !== "ready")
				throw new Error(
					`Native runtime unavailable: ${JSON.stringify(status)}`
				);
			return status;
		}
		const status = await window.electronAPI?.beautyLab?.inspectIndependent?.();
		if (!status?.available || !status.bodyVideo)
			throw new Error(
				`Body video runtime unavailable: ${JSON.stringify(status)}`
			);
		return status;
	}, engine);
	const project = await page.evaluate(
		async ({ seconds, engine }) => {
			const stores = window as unknown as CompositeEvidenceWindow;
			const size = { width: 1080, height: 1920 };
			stores.__editorStore.getState().setCanvasSize(size, "custom");
			await stores.__projectStore
				.getState()
				.updateProjectCanvasSize(size, "custom");
			const active = stores.__projectStore.getState().activeProject;
			const media = stores.__mediaStore.getState().mediaItems[0];
			const timeline = stores.__timelineStore.getState();
			const track = timeline.tracks.find(
				(item) => item.isMain || item.type === "media"
			);
			if (!active || !media || !track || active.fps !== 30)
				throw new Error("Missing 30fps segmented body project");
			const half = seconds / 2;
			const clips = [
				{ startTime: 0, trimStart: 0, slim: 40, stretch: 30 },
				{ startTime: half, trimStart: 1, slim: 55, stretch: 20 },
			].map(({ startTime, trimStart, slim, stretch }, index) => {
				const id = timeline.addElementToTrack(track.id, {
					type: "media",
					mediaId: media.id,
					name: `${index === 0 ? "A" : "B"} ${media.name}`,
					// Timeline duration includes trimStart; each visible span is half.
					duration: half + trimStart,
					startTime,
					trimStart,
					trimEnd: 0,
				});
				if (!id) throw new Error("Cannot add segmented body clip");
				const adjustments = {
					enabled: true,
					engine,
					values: {
						body_adjust_SlimBody: slim,
						body_adjust_StretchLeg: stretch,
					},
				};
				timeline.updateMediaElement(track.id, id, {
					fitMode: "cover",
					portraitAdjustments: adjustments,
				});
				return { id, startTime, trimStart, seconds: half, adjustments };
			});
			timeline.setSelectedElements([]);
			stores.__playbackStore.getState().pause();
			return {
				projectId: active.id,
				trackId: track.id,
				mediaId: media.id,
				clips,
				duration: stores.__timelineStore.getState().getTotalDuration(),
			};
		},
		{ seconds, engine }
	);
	expect(project.duration).toBe(seconds);
	return { runtime, ...project };
}
