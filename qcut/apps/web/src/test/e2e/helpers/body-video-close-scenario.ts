/**
 * The single-person dynamic body closure scenario: one clean 6 s clip of the
 * locked real source (1080×1920, 30 fps timeline, 180 frames, walking and
 * turning), graded three ways — untouched, native smart body, independent
 * smart body — with the already-measured slim 40 + long-leg 30 values.
 *
 * Unlike the portrait composite, there is no dissolve, crop or keyframe: a
 * difference between two passes must come from the body effect alone.
 */
import type { Page } from "@playwright/test";
import type { MediaPortraitAdjustments } from "../../../types/timeline";
import {
	createTestProject,
	navigateToProjects,
	uploadTestMedia,
} from "./electron-helpers";
import type {
	CompositeEvidenceWindow,
	CompositeProject,
	CompositeSettings,
	PortraitCompositePass,
} from "./portrait-composite-project";
import type { CompositeScenarioPass } from "./portrait-composite-runner";

/** The locked edit: the values the body-video session E2E already verified. */
export const BODY_CLOSE_VALUES: MediaPortraitAdjustments["values"] = {
	body_adjust_SlimBody: 40,
	body_adjust_StretchLeg: 30,
};

export const BODY_CLOSE_PASSES: PortraitCompositePass[] = [
	"original",
	"native",
	"independent",
];

/** `count` indices spread over `total` frames, first and last included. */
export function spreadSampleIndices({
	total,
	count,
}: {
	total: number;
	count: number;
}): number[] {
	if (!Number.isInteger(total) || total < 2 || !Number.isInteger(count))
		throw new Error("Invalid sample spread");
	if (count < 2 || count > 32 || count > total)
		throw new Error("Sample count must be 2..32 and fit the clip");
	return [
		...new Set(
			Array.from({ length: count }, (_, index) =>
				Math.round((index * (total - 1)) / (count - 1))
			)
		),
	];
}

function bodyClosePass({
	id,
}: {
	id: PortraitCompositePass;
}): CompositeScenarioPass {
	if (id === "original")
		return { id, adjustments: { enabled: false, values: {} } };
	return {
		id,
		adjustments: {
			enabled: true,
			engine: id,
			values: { ...BODY_CLOSE_VALUES },
		},
	};
}

export function createBodyVideoCloseScenario({
	seconds = 6,
	fps = 30,
	sampleCount = 16,
	passes = BODY_CLOSE_PASSES,
}: {
	seconds?: number;
	fps?: 24 | 25 | 30 | 60;
	sampleCount?: number;
	passes?: PortraitCompositePass[];
} = {}): {
	passes: CompositeScenarioPass[];
	settings: CompositeSettings;
	previewIndices: number[];
} {
	const totalFrames = seconds * fps;
	if (!Number.isInteger(totalFrames) || totalFrames < 2 || seconds > 60)
		throw new Error("Invalid body closure duration");
	if (passes.length === 0) throw new Error("No body closure passes selected");
	const samples = spreadSampleIndices({
		total: totalFrames,
		count: sampleCount,
	});
	const settings: CompositeSettings = {
		width: 1080,
		height: 1920,
		fps,
		seconds,
		totalFrames,
		// No dissolve: every captured frame has exactly one layer.
		transitionSeconds: 0,
		fit: "cover",
		samples,
	};
	return {
		passes: passes.map((id) => bodyClosePass({ id })),
		settings,
		previewIndices: samples,
	};
}

/**
 * One clip, the whole source span the scenario asks for, no edits other than
 * the grade the runner applies per pass. Shaped like a `CompositeProject` so
 * the composite runner's export, evidence and preview capture run unchanged:
 * both "halves" point at the same element.
 */
export function createSingleClipBodyProjectPreparer({
	requireIndependentBodyVideo,
	requireNative,
}: {
	requireIndependentBodyVideo: boolean;
	requireNative: boolean;
}) {
	return async function prepareSingleClipBodyProject({
		page,
		source,
		settings,
	}: {
		page: Page;
		source: string;
		settings: CompositeSettings;
	}): Promise<CompositeProject> {
		// Tall enough for the 1:1 preview of a 1080×1920 canvas plus chrome.
		await page.setViewportSize({ width: 2400, height: 2500 });
		await page.evaluate(() => {
			localStorage.setItem(
				"qcut-app-settings",
				JSON.stringify({
					version: 1,
					state: { autoCanvasFromFirstMedia: false },
				})
			);
		});
		await page.reload();
		await navigateToProjects(page);
		await createTestProject(page, `Body video closure ${Date.now()}`);
		await uploadTestMedia(page, source);
		// Fail before the first long export, not twenty minutes into it.
		if (requireIndependentBodyVideo) {
			const status = await page.evaluate(async () => {
				const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
				return inspect ? await inspect() : null;
			});
			if (!status?.available || status.bodyVideo !== true)
				throw new Error(
					`Independent body video runtime is not ready: ${JSON.stringify(status)}`
				);
		}
		if (requireNative) {
			const status = await page.evaluate(async () => {
				const inspect = window.electronAPI?.jianyingPortraitAdjustment?.inspect;
				return inspect ? await inspect() : null;
			});
			if (!status?.ready)
				throw new Error(
					`Native portrait runtime is not ready: ${JSON.stringify(status)}`
				);
		}
		return page.evaluate(
			async ({ width, height, fps, seconds, fit }) => {
				const stores = window as unknown as CompositeEvidenceWindow;
				stores.__editorStore
					.getState()
					.setCanvasSize({ width, height }, "custom");
				await stores.__projectStore
					.getState()
					.updateProjectCanvasSize({ width, height }, "custom");
				const project = stores.__projectStore.getState().activeProject;
				const media = stores.__mediaStore.getState().mediaItems[0];
				const timeline = stores.__timelineStore.getState();
				const track = timeline.tracks.find(
					(item) => item.isMain || item.type === "media"
				);
				if (!project || !media || !track)
					throw new Error("Missing body closure project input");
				if (project.fps !== fps)
					throw new Error(`Expected ${fps}fps project, got ${project.fps}`);
				const id = timeline.addElementToTrack(track.id, {
					type: "media",
					mediaId: media.id,
					name: media.name,
					duration: seconds,
					startTime: 0,
					trimStart: 0,
					trimEnd: 0,
				});
				if (!id) throw new Error("Cannot add the body clip");
				timeline.updateMediaElement(track.id, id, { fitMode: fit });
				timeline.setSelectedElements([]);
				stores.__playbackStore.getState().pause();
				return {
					projectId: project.id,
					trackId: track.id,
					elementIds: [id, id],
					transitionId: "",
				};
			},
			{
				width: settings.width,
				height: settings.height,
				fps: settings.fps,
				seconds: settings.seconds,
				fit: settings.fit,
			}
		);
	};
}
