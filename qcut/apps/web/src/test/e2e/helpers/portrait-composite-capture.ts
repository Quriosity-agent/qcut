import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { getMediaSourcePlaybackTime } from "../../../lib/video/video-timing";
import { getExportFrameSampleTime } from "../../../lib/export/export-video-frame-seek";
import type { MediaElement } from "../../../types/timeline";
import {
	COMPOSITE_SETTINGS,
	type CompositeEvidenceWindow,
	type CompositeEvidencePass,
	type CompositeSettings,
} from "./portrait-composite-project";

export interface CapturedExportFrame {
	pass: CompositeEvidencePass;
	frameIndex: number;
	timeSeconds: number;
	fps: number;
	width: number;
	height: number;
	pngSha256: string;
	rgbaSha256: string;
	file: string;
}

export const frameName = ({
	prefix,
	frameIndex,
}: {
	prefix: string;
	frameIndex: number;
}) => `${prefix}-frame-${String(frameIndex).padStart(6, "0")}`;

export async function installCompositeExportCapture({
	page,
	output,
	frames,
	settings = COMPOSITE_SETTINGS,
	allowedPasses = ["original", "native", "independent"],
}: {
	page: Page;
	output: string;
	frames: CapturedExportFrame[];
	settings?: CompositeSettings;
	allowedPasses?: CompositeEvidencePass[];
}) {
	await page.exposeFunction(
		"__savePortraitCompositeFrame",
		async (input: {
			pass: CompositeEvidencePass;
			frameIndex: number;
			timeSeconds: number;
			fps: number;
			width: number;
			height: number;
			png: string;
			rgbaSha256: string;
		}) => {
			if (
				!allowedPasses.includes(input.pass) ||
				!(settings.captureEveryFrame
					? Number.isInteger(input.frameIndex) &&
						input.frameIndex >= 0 &&
						input.frameIndex < settings.totalFrames
					: settings.samples.includes(input.frameIndex)) ||
				!/^[a-f0-9]{64}$/.test(input.rgbaSha256) ||
				input.width !== settings.width ||
				input.height !== settings.height ||
				input.fps !== settings.fps ||
				!input.png.startsWith("data:image/png;base64,") ||
				input.png.length > 64 * 1024 * 1024
			)
				throw new Error("Invalid export frame evidence");
			if (
				frames.some(
					(frame) =>
						frame.pass === input.pass && frame.frameIndex === input.frameIndex
				)
			)
				throw new Error("Duplicate export frame evidence");
			const png = Buffer.from(input.png.split(",")[1], "base64");
			const file = path.join(
				input.pass,
				`${frameName({ prefix: "export", frameIndex: input.frameIndex })}.png`
			);
			await mkdir(path.join(output, input.pass), { recursive: true });
			await writeFile(path.join(output, file), png);
			const { png: _png, ...metadata } = input;
			frames.push({
				...metadata,
				file,
				pngSha256: createHash("sha256").update(png).digest("hex"),
			});
		}
	);
}

export async function armCompositeCapture({
	page,
	pass,
	settings = COMPOSITE_SETTINGS,
}: {
	page: Page;
	pass: CompositeEvidencePass;
	settings?: CompositeSettings;
}) {
	await page.evaluate(
		({ pass, frameIndices, captureEveryFrame, totalFrames }) => {
			const target = window as unknown as CompositeEvidenceWindow;
			const sink: NonNullable<
				CompositeEvidenceWindow["__qcutExportFrameEvidence"]
			> = {
				frameIndices,
				capture: async ({ canvas, frameIndex, timeSeconds, fps }) => {
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Missing export evidence canvas");
					const rgba = context.getImageData(
						0,
						0,
						canvas.width,
						canvas.height
					).data;
					const digest = await crypto.subtle.digest("SHA-256", rgba);
					const rgbaSha256 = Array.from(new Uint8Array(digest), (byte) =>
						byte.toString(16).padStart(2, "0")
					).join("");
					await target.__savePortraitCompositeFrame({
						pass,
						frameIndex,
						timeSeconds,
						fps,
						width: canvas.width,
						height: canvas.height,
						png: canvas.toDataURL("image/png"),
						rgbaSha256,
					});
					if (captureEveryFrame)
						sink.frameIndices =
							frameIndex + 1 < totalFrames ? [frameIndex + 1] : [];
				},
			};
			target.__qcutExportFrameEvidence = sink;
		},
		{
			pass,
			frameIndices: settings.captureEveryFrame ? [0] : settings.samples,
			captureEveryFrame: settings.captureEveryFrame === true,
			totalFrames: settings.totalFrames,
		}
	);
}

export async function captureCompositePreview({
	page,
	output,
	pass,
	frameIndex,
	settings = COMPOSITE_SETTINGS,
}: {
	page: Page;
	output: string;
	pass: CompositeEvidencePass;
	frameIndex: number;
	settings?: CompositeSettings;
}) {
	const timeSeconds = frameIndex / settings.fps;
	const inTransition =
		timeSeconds >= (settings.seconds - settings.transitionSeconds) / 2 &&
		timeSeconds < (settings.seconds + settings.transitionSeconds) / 2;
	const expectedLayers = inTransition ? 2 : 1;
	await page.mouse.move(10, 10);
	await page.evaluate((time) => {
		const playback = (
			window as unknown as CompositeEvidenceWindow
		).__playbackStore.getState();
		playback.pause();
		playback.seek(time);
	}, timeSeconds);
	const elements = await page.evaluate(() =>
		(window as unknown as CompositeEvidenceWindow).__timelineStore
			.getState()
			.tracks.flatMap((track) => track.elements)
			.filter((element): element is MediaElement => element.type === "media")
	);
	const sourceTimes = Object.fromEntries(
		elements.map((element) => [
			element.id,
			getMediaSourcePlaybackTime({
				element,
				localTimelineTime: getExportFrameSampleTime({
					frameRate: settings.fps,
					frameStartTime: Math.max(0, timeSeconds - element.startTime),
				}),
				fps: settings.fps,
			}),
		])
	);
	const surface = page.getByTestId("preview-capture-surface");
	const assertCommittedPreview = async () => {
		await expect
			.poll(
				() =>
					surface.locator("video").evaluateAll(
						(videos, { sourceTimes, expectedLayers }) =>
							videos.length === expectedLayers &&
							videos.every((node) => {
								const video = node as HTMLVideoElement;
								const id = video.closest<HTMLElement>(
									"[data-preview-element-id]"
								)?.dataset.previewElementId;
								const expectedTime = id ? sourceTimes[id] : undefined;
								return (
									!video.seeking &&
									video.readyState >= 2 &&
									video.videoWidth > 0 &&
									expectedTime !== undefined &&
									Math.abs(video.currentTime - expectedTime) <= 0.0001
								);
							}),
						{ sourceTimes, expectedLayers }
					),
				{ timeout: 180_000 }
			)
			.toBe(true);

		await expect
			.poll(
				async () => {
					const error = page.getByTestId("canvas-composition-preview-error");
					if (await error.count())
						throw new Error(
							(await error.getAttribute("title")) ??
								"Canvas composition preview failed"
						);
					return surface
						.locator('[data-canvas-composition-preview="ready"]')
						.evaluateAll(
							(nodes, expected) =>
								nodes.length === 1 &&
								nodes.every((node) => {
									const image = node as HTMLImageElement;
									return (
										image.complete &&
										image.naturalWidth === expected.width &&
										image.naturalHeight === expected.height &&
										Number(image.dataset.frame) === expected.frame
									);
								}),
							{
								width: settings.width,
								height: settings.height,
								frame: frameIndex,
							}
						);
				},
				{ timeout: 300_000 }
			)
			.toBe(true);
	};
	await assertCommittedPreview();

	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			})
	);
	await assertCommittedPreview();
	await expect(page.getByTestId("preview-frame-cache-overlay")).toHaveAttribute(
		"data-visible",
		"false"
	);
	await expect(
		page.getByTestId("native-composition-preview-loading")
	).toHaveCount(0);
	await expect(
		page.getByTestId("native-composition-preview-error")
	).toHaveCount(0);
	const layers = await surface.evaluate((node) => {
		const describe = ({ element }: { element: Element }) => {
			const style = getComputedStyle(element);
			const box = element.getBoundingClientRect();
			return {
				tag: element.tagName,
				testId: element.getAttribute("data-testid"),
				elementId: element.getAttribute("data-preview-element-id"),
				className: element.getAttribute("class"),
				box: { x: box.x, y: box.y, width: box.width, height: box.height },
				style: {
					display: style.display,
					position: style.position,
					zIndex: style.zIndex,
					opacity: style.opacity,
					visibility: style.visibility,
					transform: style.transform,
					transformOrigin: style.transformOrigin,
					clipPath: style.clipPath,
					overflow: style.overflow,
					background: style.background,
					filter: style.filter,
					mixBlendMode: style.mixBlendMode,
					isolation: style.isolation,
					objectFit: style.objectFit,
				},
			};
		};
		const ancestors = ({ element }: { element: Element }) => {
			const chain = [];
			for (
				let parent = element.parentElement;
				parent;
				parent = parent.parentElement
			)
				chain.push(describe({ element: parent }));
			return chain;
		};
		// Preserve the whole preview, including compositor/cache siblings of the surface.
		for (
			let branch: Element | null = node.parentElement;
			branch?.parentElement;
			branch = branch.parentElement
		) {
			for (const sibling of branch.parentElement.children) {
				if (sibling !== branch)
					sibling.setAttribute("data-composite-capture-occluder", "true");
			}
		}
		return {
			...describe({ element: node }),
			captureAuthority: "committed full-resolution canvas composition",
			underlyingPreviewStatus:
				"diagnostic only; superseded by opaque exact composition",
			ancestors: ancestors({ element: node }),
			devicePixelRatio,
			previewOverlays: [...(node.parentElement?.children ?? [])]
				.filter((element) => element !== node)
				.map((element) => describe({ element })),
			images: [...node.querySelectorAll("img")].map((image) => ({
				complete: image.complete,
				naturalWidth: image.naturalWidth,
				naturalHeight: image.naturalHeight,
				frame: image.dataset.frame,
				timeSeconds: image.dataset.timeSeconds,
				canvasComposition: image.dataset.canvasCompositionPreview,
				element: describe({ element: image }),
			})),
			videos: [...node.querySelectorAll("video")].map((video) => ({
				currentTime: video.currentTime,
				width: video.videoWidth,
				height: video.videoHeight,
				seeking: video.seeking,
				readyState: video.readyState,
				element: describe({ element: video }),
				ancestors: ancestors({ element: video }),
			})),
			canvases: [
				...node.querySelectorAll<HTMLCanvasElement>(
					'[data-testid="color-preview-canvas"]'
				),
			].map((canvas) => ({
				width: canvas.width,
				height: canvas.height,
				commits: Number(canvas.dataset.renderedFrameCount ?? 0),
				frameSeed: canvas.dataset.renderedFrameSeed,
				sourceTimestampSeconds: canvas.dataset.renderedSourceTimestampSeconds,
				portraitStatus: canvas.dataset.renderedPortraitStatus,
				portraitEngine: canvas.dataset.renderedPortraitEngine,
				geometry: canvas.dataset.renderedPortraitGeometry,
				element: describe({ element: canvas }),
				ancestors: ancestors({ element: canvas }),
			})),
		};
	});
	expect(layers.box.width).toBeCloseTo(settings.width, 4);
	expect(layers.box.height).toBeCloseTo(settings.height, 4);
	expect(layers.box.x).toBeCloseTo(Math.round(layers.box.x), 4);
	expect(layers.box.y).toBeCloseTo(Math.round(layers.box.y), 4);
	const name = frameName({ prefix: "preview", frameIndex });
	const file = path.join(pass, `${name}.png`);
	const png = await surface
		.screenshot({
			path: path.join(output, file),
			animations: "disabled",
			scale: "css",
			style:
				'[data-composite-capture-occluder="true"], [data-testid="media-transform-overlay"], [data-testid="portrait-face-overlay"] { visibility: hidden !important; }',
		})
		.finally(() =>
			page.evaluate(() => {
				for (const element of document.querySelectorAll(
					"[data-composite-capture-occluder]"
				))
					element.removeAttribute("data-composite-capture-occluder");
			})
		);
	const rawLayers = await surface
		.getByTestId("color-preview-canvas")
		.evaluateAll((nodes) =>
			nodes.map((node) => (node as HTMLCanvasElement).toDataURL("image/png"))
		);
	const compositionPng = await surface
		.locator('[data-canvas-composition-preview="ready"]')
		.evaluate(async (node) => {
			const image = node as HTMLImageElement;
			const response = await fetch(image.currentSrc || image.src);
			if (!response.ok)
				throw new Error(`Cannot read composition preview: ${response.status}`);
			const blob = await response.blob();
			return new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					if (typeof reader.result !== "string") {
						reject(new Error("Composition preview did not return PNG data"));
						return;
					}
					resolve(reader.result);
				};
				reader.onerror = () =>
					reject(reader.error ?? new Error("Cannot read composition preview"));
				reader.onabort = () =>
					reject(new Error("Composition preview read was aborted"));
				reader.readAsDataURL(blob);
			});
		});
	await writeFile(
		path.join(output, pass, `${name}-composition.png`),
		Buffer.from(compositionPng.split(",")[1], "base64")
	);
	await Promise.all(
		rawLayers.map((url, index) =>
			writeFile(
				path.join(output, pass, `${name}-layer-${index}.png`),
				Buffer.from(url.split(",")[1], "base64")
			)
		)
	);
	await writeFile(
		path.join(output, pass, `${name}-layers.json`),
		`${JSON.stringify(layers, null, 2)}\n`
	);
	await page.screenshot({
		path: path.join(output, pass, `${name}-ui.png`),
		animations: "disabled",
		scale: "css",
	});
	return {
		pass,
		frameIndex,
		timeSeconds,
		file,
		pngSha256: createHash("sha256").update(png).digest("hex"),
		layers,
	};
}
