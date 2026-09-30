import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
	navigateToProjects,
	createTestProject,
	uploadTestMedia,
} from "./electron-helpers";
import type { useEditorStore } from "../../../stores/editor-store";
import type { useMediaStore } from "../../../stores/media-store";
import type { useProjectStore } from "../../../stores/project-store";
import type { useTimelineStore } from "../../../stores/timeline-store";

export async function preparePortraitReferenceProject({
	page,
	source,
	duration = 1,
	canvasSize = { width: 1080, height: 1620 },
}: {
	page: Page;
	source: string;
	duration?: number;
	canvasSize?: { width: number; height: number };
}) {
	await page.setViewportSize({ width: 1800, height: 1100 });
	// Keep the calibration canvas fixed; first-media auto sizing is asynchronous.
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
	await createTestProject(page, `Portrait Slider Reference ${Date.now()}`);
	await uploadTestMedia(page, source);
	await page.evaluate(
		async ({ duration, canvasSize }) => {
			const stores = window as unknown as ReferenceWindow;
			const size = canvasSize;
			stores.__editorStore.getState().setCanvasSize(size, "custom");
			await stores.__projectStore
				.getState()
				.updateProjectCanvasSize(size, "custom");
			const media = stores.__mediaStore.getState().mediaItems[0];
			const timeline = stores.__timelineStore.getState();
			const track = timeline.tracks.find(
				(candidate) => candidate.isMain || candidate.type === "media"
			);
			if (!media || !track)
				throw new Error("Missing imported portrait or track");
			const elementId = timeline.addElementToTrack(track.id, {
				type: "media",
				mediaId: media.id,
				name: media.name,
				duration,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
			});
			if (!elementId) throw new Error("Cannot insert portrait");
			timeline.setSelectedElements([{ trackId: track.id, elementId }]);
		},
		{ duration, canvasSize }
	);
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const panel = page.getByTestId("jianying-portrait-adjustments");
	await expect(
		page.getByTestId("jianying-portrait-runtime-status")
	).toContainText("就绪", { timeout: 30_000 });
	await panel.getByRole("switch", { name: "启用原版美颜美体" }).click();
	await panel.getByRole("button", { name: "五官精修", exact: true }).click();
	const features = page.getByTestId("portrait-section-features");
	await expect(
		features.getByRole("button", { name: "眼睛", exact: true })
	).toHaveAttribute("aria-pressed", "true");
	return { panel, features };
}

export interface ReferenceWindow extends Window {
	__editorStore: typeof useEditorStore;
	__mediaStore: typeof useMediaStore;
	__projectStore: typeof useProjectStore;
	__timelineStore: typeof useTimelineStore;
}

export async function readValues({ page }: { page: Page }) {
	return page.evaluate(() => {
		const timeline = (
			window as unknown as ReferenceWindow
		).__timelineStore.getState();
		const element = timeline.tracks.flatMap((track) => track.elements)[0];
		return element?.type === "media"
			? element.portraitAdjustments?.values
			: undefined;
	});
}

export async function readPreview({ page }: { page: Page }) {
	const frame = await page
		.getByTestId("color-preview-canvas")
		.evaluate((node) => {
			const canvas = node as HTMLCanvasElement;
			const data = canvas
				.getContext("2d")
				?.getImageData(0, 0, canvas.width, canvas.height).data;
			let opaque = 0;
			let visible = 0;
			if (data) {
				for (let index = 3; index < data.length; index += 4) {
					if (data[index] > 0) opaque += 1;
					if (
						data[index] > 16 &&
						Math.max(data[index - 3], data[index - 2], data[index - 1]) > 16
					)
						visible += 1;
				}
			}
			return {
				url: canvas.toDataURL("image/png"),
				width: canvas.width,
				height: canvas.height,
				opaque,
				visible,
				commits: Number(canvas.dataset.renderedFrameCount ?? 0),
			};
		});
	const png = Buffer.from(frame.url.split(",")[1], "base64");
	return {
		...frame,
		png,
		hash: createHash("sha256").update(png).digest("hex"),
	};
}

export function createPortraitReferenceCapture({ output }: { output: string }) {
	async function captureSource({ page, name }: { page: Page; name: string }) {
		const data = await page
			.getByTestId("color-preview-canvas")
			.evaluate((node) => {
				const source = node.parentElement?.querySelector("img");
				if (!source) throw new Error("Missing portrait source image");
				const preview = node as HTMLCanvasElement;
				const canvas = document.createElement("canvas");
				canvas.width = preview.width;
				canvas.height = preview.height;
				canvas
					.getContext("2d", { willReadFrequently: true })
					?.drawImage(source, 0, 0, canvas.width, canvas.height);
				return {
					url: canvas.toDataURL(),
					sourceWidth: source.naturalWidth,
					sourceHeight: source.naturalHeight,
				};
			});
		await writeFile(
			path.join(output, `${name}-input.png`),
			Buffer.from(data.url.split(",")[1], "base64")
		);
		return { sourceWidth: data.sourceWidth, sourceHeight: data.sourceHeight };
	}

	async function changeAndCapture({
		page,
		label,
		value,
		name,
		previousHash,
	}: {
		page: Page;
		label: string;
		value: number;
		name: string;
		previousHash?: string;
	}) {
		const input = page.getByLabel(`${label}数值`, { exact: true });
		// Resizing can leave the pointer over timeline hover-scrub instead of this control.
		await input.hover();
		await input.fill(String(value));
		await input.press("Tab");
		await expect(input).toHaveValue(String(value));
		await expect(page.getByTestId("color-preview-canvas")).toBeVisible({
			timeout: 30_000,
		});
		let lastHash = "";
		let repeats = 0;
		let stableFrame: Awaited<ReturnType<typeof readPreview>> | undefined;
		await expect
			.poll(
				async () => {
					const frame = await readPreview({ page });
					if (
						frame.visible <= 10_000 ||
						frame.commits === 0 ||
						frame.hash === previousHash
					) {
						repeats = 0;
						lastHash = "";
						return repeats;
					}
					repeats = frame.hash === lastHash ? repeats + 1 : 0;
					lastHash = frame.hash;
					stableFrame = frame;
					return repeats;
				},
				{ timeout: 30_000, intervals: [300] }
			)
			.toBeGreaterThanOrEqual(3);
		// A second read can hit a resize clear after the stable frame was verified.
		const frame = stableFrame;
		if (!frame) throw new Error("No stable portrait frame captured");
		await writeFile(path.join(output, `${name}-frame.png`), frame.png);
		await page.screenshot({
			path: path.join(output, `${name}-ui.png`),
			animations: "disabled",
		});
		return {
			name,
			label,
			value,
			hash: frame.hash,
			width: frame.width,
			height: frame.height,
			values: await readValues({ page }),
		};
	}
	return { captureSource, changeAndCapture };
}
