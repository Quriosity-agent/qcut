/**
 * Real in-house stabilization through the preview and the muxer export.
 *
 * A synthetic clip pans and rotates a crop window over a static fractal, so
 * every bit of inter-frame motion is camera shake. The test enables 视频防抖
 * on the clip, waits for the stabilized preview canvas (analysis → plan →
 * canvas), exports through the canvas muxer, and measures the exported
 * clip's residual motion with the same OpenCV estimator the product uses.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { uploadTestMedia } from "./helpers/e2e-panel-helpers";
import { createTestProject, expect } from "./helpers/electron-helpers";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import {
	borderLuminanceRatio,
	decodeGrayFrames,
	generateShakyStillClip,
	measureJitter,
} from "./helpers/stabilization-export-evidence";
import { probeVideo, savePngFrame } from "./helpers/transition-export-evidence";

const CLIP_SECONDS = 6;
const WIDTH = 1280;
const HEIGHT = 720;
const EVIDENCE_DIR = path.resolve(
	process.cwd(),
	"output/playwright/stabilization"
);

interface ExposedWindow extends Window {
	__exportActions?: {
		exportLocalVideo: (request: {
			engine: "muxer";
			filename: string;
			format: "mp4";
			frameRate: 30;
			height: number;
			outputPath: string;
			projectId: string;
			quality: "720p";
			width: number;
		}) => Promise<void>;
	};
	__mediaStore: {
		getState: () => {
			mediaItems: Array<{ id: string; localPath?: string; name: string }>;
		};
	};
	__projectStore: {
		getState: () => { activeProject: { id: string } | null };
	};
	__timelineStore: {
		getState: () => {
			tracks: Array<{ id: string; isMain?: boolean; type: string }>;
			addElementToTrack: (
				trackId: string,
				element: {
					duration: number;
					mediaId: string;
					name: string;
					startTime: number;
					trimEnd: number;
					trimStart: number;
					type: "media";
				}
			) => string | null;
			updateMediaElement: (
				trackId: string,
				elementId: string,
				updates: {
					enhancements: {
						stabilization: number;
						denoise: number;
						clarity: number;
						upscale: 1;
						relight: number;
						beauty: number;
					};
				}
			) => void;
		};
	};
}

async function placeStabilizedClip({
	page,
	name,
}: {
	page: Page;
	name: string;
}): Promise<{ projectId: string }> {
	return page.evaluate(
		({ name, clipSeconds }) => {
			const editorWindow = window as unknown as ExposedWindow;
			const projectId =
				editorWindow.__projectStore.getState().activeProject?.id;
			if (!projectId) throw new Error("No active project");
			const item = editorWindow.__mediaStore
				.getState()
				.mediaItems.find((candidate) => candidate.name === name);
			if (!item) throw new Error(`Media ${name} was not imported`);
			const timeline = editorWindow.__timelineStore.getState();
			const track = timeline.tracks.find(
				(candidate) => candidate.isMain || candidate.type === "media"
			);
			if (!track) throw new Error("Missing media track");
			const elementId = timeline.addElementToTrack(track.id, {
				type: "media",
				mediaId: item.id,
				name: item.name,
				duration: clipSeconds,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
			});
			if (!elementId) throw new Error("Could not place the clip");
			timeline.updateMediaElement(track.id, elementId, {
				enhancements: {
					stabilization: 50,
					denoise: 0,
					clarity: 0,
					upscale: 1,
					relight: 0,
					beauty: 0,
				},
			});
			return { projectId };
		},
		{ name, clipSeconds: CLIP_SECONDS }
	);
}

async function exportWithMuxer({
	page,
	projectId,
	outputPath,
}: {
	page: Page;
	projectId: string;
	outputPath: string;
}): Promise<number> {
	await page.getByTestId("export-button").click();
	await expect(page.getByTestId("export-dialog")).toBeVisible();
	await page.waitForFunction(
		() => Boolean((window as unknown as ExposedWindow).__exportActions),
		undefined,
		{ timeout: 10_000 }
	);
	const startedAt = Date.now();
	await page.evaluate(
		async ({ projectId, outputPath, width, height }) => {
			const actions = (window as unknown as ExposedWindow).__exportActions;
			if (!actions) throw new Error("Export actions are not registered");
			await actions.exportLocalVideo({
				engine: "muxer",
				filename: "stabilized.mp4",
				format: "mp4",
				frameRate: 30,
				height,
				outputPath,
				projectId,
				quality: "720p",
				width,
			});
		},
		{ projectId, outputPath, width: WIDTH, height: HEIGHT }
	);
	return Date.now() - startedAt;
}

test.describe("in-house stabilization", () => {
	test.setTimeout(300_000);

	test("stabilizes a shaky clip in the preview and the muxer export", async ({
		page,
	}) => {
		const workDir = await mkdtemp(path.join(tmpdir(), "qcut-stabilization-"));
		try {
			const clipPath = path.join(workDir, "shaky-still.mp4");
			await generateShakyStillClip({
				outputPath: clipPath,
				seconds: CLIP_SECONDS,
			});

			await createTestProject(page, "Stabilization E2E");
			await uploadTestMedia(page, clipPath);
			const { projectId } = await placeStabilizedClip({
				page,
				name: "shaky-still.mp4",
			});

			// Preview: analysis → plan → the stabilized canvas replaces the video.
			const canvas = page.getByTestId("stabilized-video-canvas");
			await expect(canvas).toBeAttached({ timeout: 180_000 });
			await expect
				.poll(
					() =>
						canvas.evaluate((node) => node.getAttribute("data-source-time")),
					{ timeout: 20_000 }
				)
				.not.toBeNull();
			const proxyStatus = await page
				.locator("[data-video-enhancement-proxy-status]")
				.first()
				.getAttribute("data-video-enhancement-proxy-status");
			// Stabilization alone must not spin up the FFmpeg deshake proxy.
			expect(proxyStatus).toBe("idle");

			const outputPath = path.join(workDir, "stabilized.mp4");
			const exportMs = await exportWithMuxer({ page, projectId, outputPath });
			const probe = await probeVideo({ filePath: outputPath });
			expect(probe.width).toBe(WIDTH);
			expect(probe.height).toBe(HEIGHT);
			expect(probe.frameCount).toBeGreaterThanOrEqual(CLIP_SECONDS * 30 - 5);

			const input = await decodeGrayFrames({ filePath: clipPath });
			const output = await decodeGrayFrames({ filePath: outputPath });
			const inputJitter = await measureJitter({ gray: input });
			const outputJitter = await measureJitter({ gray: output });
			const borderRatio = borderLuminanceRatio({ gray: output });
			const evidence = {
				exportMs,
				probe,
				inputJitter,
				outputJitter,
				translationRatio:
					outputJitter.rmsTranslationPx / inputJitter.rmsTranslationPx,
				rotationRatio: outputJitter.rmsRotationDeg / inputJitter.rmsRotationDeg,
				borderLuminanceRatio: borderRatio,
			};
			await mkdir(EVIDENCE_DIR, { recursive: true });
			await writeFile(
				path.join(EVIDENCE_DIR, "evidence.json"),
				JSON.stringify(evidence, null, 2)
			);
			await savePngFrame({
				filePath: clipPath,
				timeSeconds: 2,
				outputPath: path.join(EVIDENCE_DIR, "input-2s.png"),
			});
			await savePngFrame({
				filePath: outputPath,
				timeSeconds: 2,
				outputPath: path.join(EVIDENCE_DIR, "output-2s.png"),
			});
			console.log(JSON.stringify(evidence, null, 2));

			expect(inputJitter.lostFrames).toBe(0);
			expect(inputJitter.rmsTranslationPx).toBeGreaterThan(2);
			expect(outputJitter.lostFrames).toBe(0);
			// The static scene should come back nearly still.
			expect(evidence.translationRatio).toBeLessThan(0.35);
			expect(evidence.rotationRatio).toBeLessThan(0.5);
			// No black borders: the lens motion constraint keeps the window inside.
			expect(borderRatio).toBeGreaterThan(0.6);
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	});
});
