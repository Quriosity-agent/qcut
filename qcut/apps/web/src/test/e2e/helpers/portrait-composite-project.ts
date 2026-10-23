import { expect, type Page } from "@playwright/test";
import type { ClaudeLocalVideoExportRequest } from "../../../../../../electron/types/claude-local-video-export-api";
import type { ExportFrameEvidenceSink } from "../../../lib/export/export-frame-evidence";
import type { ExportProfileReport } from "../../../lib/export/export-profiler";
import type { usePlaybackStore } from "../../../stores/editor/playback-store";
import type { useExportStore } from "../../../stores/export-store";
import type { MediaPortraitAdjustments } from "../../../types/timeline";
import {
	createTestProject,
	navigateToProjects,
	uploadTestMedia,
} from "./electron-helpers";
import type { ReferenceWindow } from "./portrait-reference";

export type PortraitCompositePass = "original" | "native" | "independent";
export type CompositeEvidencePass =
	| PortraitCompositePass
	| "smart"
	| "manual"
	| "combined";
export const COMPOSITE_WIDTH = 1080;
export const COMPOSITE_HEIGHT = 1920;
export const COMPOSITE_FPS: ClaudeLocalVideoExportRequest["frameRate"] = 30;
export const COMPOSITE_SECONDS = Number(
	process.env.QCUT_PORTRAIT_COMPOSITE_SECONDS ?? 12
);
export const COMPOSITE_TOTAL_FRAMES = Math.round(
	COMPOSITE_SECONDS * COMPOSITE_FPS
);
export const COMPOSITE_TRANSITION_SECONDS = Math.min(1, COMPOSITE_SECONDS / 2);
export const COMPOSITE_FIT: "contain" | "cover" =
	process.env.QCUT_PORTRAIT_COMPOSITE_FIT === "contain" ? "contain" : "cover";
const configuredSamples = process.env.QCUT_PORTRAIT_COMPOSITE_SAMPLES;
export const COMPOSITE_SAMPLES = [
	...new Set(
		configuredSamples
			? configuredSamples.split(",").map(Number)
			: [0, 1 / 12, 0.25, 0.46, 0.5, 0.54, 0.75, 1].map((fraction) =>
					Math.min(
						COMPOSITE_TOTAL_FRAMES - 1,
						Math.floor(COMPOSITE_TOTAL_FRAMES * fraction)
					)
				)
	),
].sort((left, right) => left - right);
if (
	!Number.isFinite(COMPOSITE_SECONDS) ||
	COMPOSITE_TOTAL_FRAMES < 4 ||
	COMPOSITE_SECONDS > 60 ||
	COMPOSITE_SAMPLES.length > 32 ||
	COMPOSITE_SAMPLES.some(
		(frame) =>
			!Number.isInteger(frame) || frame < 0 || frame >= COMPOSITE_TOTAL_FRAMES
	)
) {
	throw new Error("Invalid composite duration or sample frame indices");
}

export interface CompositeSettings {
	width: number;
	height: number;
	fps: ClaudeLocalVideoExportRequest["frameRate"];
	seconds: number;
	totalFrames: number;
	transitionSeconds: number;
	fit: "cover" | "contain";
	samples: number[];
	captureEveryFrame?: boolean;
}

export const COMPOSITE_SETTINGS: CompositeSettings = {
	width: COMPOSITE_WIDTH,
	height: COMPOSITE_HEIGHT,
	fps: COMPOSITE_FPS,
	seconds: COMPOSITE_SECONDS,
	totalFrames: COMPOSITE_TOTAL_FRAMES,
	transitionSeconds: COMPOSITE_TRANSITION_SECONDS,
	fit: COMPOSITE_FIT,
	samples: COMPOSITE_SAMPLES,
};

export interface CompositeEvidenceWindow extends ReferenceWindow {
	__playbackStore: typeof usePlaybackStore;
	__exportStore: typeof useExportStore;
	__exportActions?: {
		exportLocalVideo: (request: ClaudeLocalVideoExportRequest) => Promise<void>;
	};
	__exportProfiler: {
		arm: (options: { targetPath: string }) => void;
		buildReport: (meta: Record<string, unknown>) => ExportProfileReport;
	};
	__qcutExportFrameEvidence?: ExportFrameEvidenceSink;
	__savePortraitCompositeFrame: (input: {
		pass: CompositeEvidencePass;
		frameIndex: number;
		timeSeconds: number;
		fps: number;
		width: number;
		height: number;
		png: string;
		rgbaSha256: string;
	}) => Promise<void>;
}

export interface CompositeProject {
	projectId: string;
	trackId: string;
	elementIds: string[];
	transitionId: string;
}

export async function prepareCompositeProject({
	page,
	source,
	settings = COMPOSITE_SETTINGS,
}: {
	page: Page;
	source: string;
	settings?: CompositeSettings;
}): Promise<CompositeProject> {
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
	await createTestProject(page, `Portrait composite consistency ${Date.now()}`);
	await uploadTestMedia(page, source);
	return page.evaluate(
		async ({ width, height, fps, seconds, fit, transitionSeconds }) => {
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
				throw new Error("Missing composite project input");
			if (project.fps !== fps)
				throw new Error(`Expected ${fps}fps project, got ${project.fps}`);
			const half = seconds / 2;
			const elementIds = [0, 1].map((index) => {
				const id = timeline.addElementToTrack(track.id, {
					type: "media",
					mediaId: media.id,
					name: `${media.name} · ${index + 1}`,
					duration: half,
					startTime: index * half,
					trimStart: 0,
					trimEnd: 0,
				});
				if (!id) throw new Error("Cannot add composite clip");
				return id;
			});
			for (const [index, id] of elementIds.entries()) {
				const keyframe = ({
					frame,
					value,
				}: {
					frame: number;
					value: number;
				}) => ({
					id: `${id}-${frame}-${value}`,
					frame,
					value,
					easing: "linear" as const,
				});
				timeline.updateMediaElement(track.id, id, {
					duration: seconds,
					trimStart: index * half,
					trimEnd: index === 0 ? half : 0,
					fitMode: fit,
					crop: { top: 0.025, right: 0.03, bottom: 0.015, left: 0.02 },
					keyframes: {
						scaleX: [
							keyframe({ frame: 0, value: 1 }),
							keyframe({ frame: half * fps - 1, value: 1.035 }),
						],
						scaleY: [
							keyframe({ frame: 0, value: 1 }),
							keyframe({ frame: half * fps - 1, value: 1.035 }),
						],
						cropLeft: [
							keyframe({ frame: 0, value: 0.02 }),
							keyframe({ frame: half * fps - 1, value: 0.045 }),
						],
					},
				});
			}
			const transitionId = timeline.addTransition({
				trackId: track.id,
				fromElementId: elementIds[0],
				toElementId: elementIds[1],
				videoMediaIds: new Set([media.id]),
				presetId: "soft-dissolve",
				engine: "qcut",
				type: "dissolve",
				duration: transitionSeconds,
				easing: "linear",
			});
			if (!transitionId) throw new Error("Cannot add composite dissolve");
			timeline.setSelectedElements([]);
			stores.__playbackStore.getState().pause();
			return {
				projectId: project.id,
				trackId: track.id,
				elementIds,
				transitionId,
			};
		},
		{
			width: settings.width,
			height: settings.height,
			fps: settings.fps,
			seconds: settings.seconds,
			fit: settings.fit,
			transitionSeconds: settings.transitionSeconds,
		}
	);
}

export async function selectCompositePass({
	page,
	project,
	pass,
}: {
	page: Page;
	project: CompositeProject;
	pass: PortraitCompositePass;
}) {
	const adjustments = portraitCompositeAdjustments({ pass });
	await applyCompositeAdjustments({ page, project, adjustments });
	return adjustments;
}

export function portraitCompositeAdjustments({
	pass,
}: {
	pass: PortraitCompositePass;
}): MediaPortraitAdjustments {
	return pass === "original"
		? { enabled: false, values: {} }
		: {
				enabled: true,
				engine: pass,
				faceTarget: { mode: "all" },
				values: { face_adjust_TotalFace: 25, face_adjust_EnlargeEye: 20 },
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 35 } },
			};
}

export async function applyCompositeAdjustments({
	page,
	project,
	adjustments,
}: {
	page: Page;
	project: CompositeProject;
	adjustments: MediaPortraitAdjustments;
}) {
	await page.evaluate(
		({ project, adjustments }) => {
			const stores = window as unknown as CompositeEvidenceWindow;
			stores.__playbackStore.getState().pause();
			const timeline = stores.__timelineStore.getState();
			for (const id of project.elementIds) {
				timeline.updateMediaElement(project.trackId, id, {
					portraitAdjustments: adjustments,
				});
			}
			timeline.setSelectedElements([]);
		},
		{ project, adjustments }
	);
}

/** Only editor layout changes: the rendered content remains the real preview. */
export async function setOneToOnePreview({
	page,
	settings = COMPOSITE_SETTINGS,
}: {
	page: Page;
	settings?: CompositeSettings;
}) {
	await page
		.getByTestId("preview-canvas")
		.evaluate((node, { width, height }) => {
			const preview = node as HTMLElement;
			const container = preview.parentElement;
			if (!container) throw new Error("Preview layout container is missing");
			const style = getComputedStyle(container);
			const paddingX =
				Number.parseFloat(style.paddingLeft) +
				Number.parseFloat(style.paddingRight);
			const paddingY =
				Number.parseFloat(style.paddingTop) +
				Number.parseFloat(style.paddingBottom);
			Object.assign(container.style, {
				position: "fixed",
				zIndex: "10",
				left: "550px",
				top: "80px",
				flex: "none",
				width: `${width + paddingX}px`,
				height: `${height + paddingY + 180}px`,
			});
			preview.style.borderWidth = "0";
			preview.style.transform = "none";
		}, settings);
	await expect
		.poll(async () => {
			const box = await page
				.getByTestId("preview-capture-surface")
				.boundingBox();
			return box ? [Math.round(box.width), Math.round(box.height)] : [];
		})
		.toEqual([settings.width, settings.height]);
	await page.getByTestId("preview-capture-surface").evaluate((surface) => {
		const container = surface.parentElement?.parentElement;
		if (!container) throw new Error("Preview layout container is missing");
		const box = surface.getBoundingClientRect();
		container.style.left = `${Number.parseFloat(container.style.left) + Math.round(box.x) - box.x}px`;
		container.style.top = `${Number.parseFloat(container.style.top) + Math.round(box.y) - box.y}px`;
	});
}
