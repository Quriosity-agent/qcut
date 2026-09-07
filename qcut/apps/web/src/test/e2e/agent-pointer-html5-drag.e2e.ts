/**
 * Agent pointer HTML5 drag-and-drop — real Electron evidence.
 *
 * Media panel items are HTML5 drag sources (`application/x-media-item`) and
 * the timeline track only accepts drops through `dataTransfer`, so a
 * mouse-only pointer drag cannot place a clip. This test drives the real CLI
 * against an isolated QCut instance and asserts that
 * `editor:pointer:drag --dnd html5` intercepts the page's drag through CDP,
 * replays it as drag events, and lands one timeline element.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { importTestVideo } from "./helpers/e2e-panel-helpers";
import { createTestProject } from "./helpers/electron-helpers";
import { isolatedElectronTest } from "./helpers/isolated-electron-fixture";
import { runQCutPipelineCli } from "./helpers/qcut-pipeline-cli";

interface PointerDragEnvelopeData {
	action?: string;
	input?: string;
	inputMode?: string;
	dnd?: {
		mode?: string;
		intercepted?: boolean;
		backend?: string;
		mimeTypes?: string[];
	};
}

interface PointerHitTestData {
	action?: string;
	hit?: boolean;
	element?: { testId?: string | null; tagName?: string } | null;
	ancestors?: Array<{ tagName: string; testId: string }>;
}

interface TimelineSummary {
	tracks: number;
	elements: number;
	mediaElements: number;
	selectedElements: number;
}

/** The CLI wraps editor responses as data.{schema_version, command, data}. */
function editorData<T>(
	envelope: { data?: unknown } | undefined
): T | undefined {
	return (envelope?.data as { data?: T } | undefined)?.data;
}

async function runPointer({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}) {
	const evidence = await runQCutPipelineCli({ apiPort, args });
	const envelope = evidence.envelopes.find(
		(candidate) => candidate.status === "ok"
	);
	expect(envelope?.status, JSON.stringify(evidence.envelopes)).toBe("ok");
	return envelope;
}

async function clipBox({ page, index }: { page: PageHandle; index: number }) {
	const clip = page.locator('[data-testid="timeline-element"]').nth(index);
	await expect(clip).toBeVisible({ timeout: 10_000 });
	const box = await clip.boundingBox();
	if (!box) throw new Error(`timeline element ${index} has no bounding box`);
	return {
		box,
		center: {
			x: Math.round(box.x + box.width / 2),
			y: Math.round(box.y + box.height / 2),
		},
	};
}

type PageHandle = import("@playwright/test").Page;

async function visibleBox({
	page,
	testId,
}: {
	page: PageHandle;
	testId: string;
}) {
	const locator = page.getByTestId(testId).first();
	await expect(locator).toBeVisible({ timeout: 10_000 });
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${testId} has no bounding box`);
	const viewport = await page.evaluate(() => ({
		width: window.innerWidth,
		height: window.innerHeight,
	}));
	return { box, viewport };
}

async function centerOf({
	page,
	testId,
}: {
	page: PageHandle;
	testId: string;
}): Promise<{ x: number; y: number }> {
	const { box } = await visibleBox({ page, testId });
	return {
		x: Math.round(box.x + box.width / 2),
		y: Math.round(box.y + box.height / 2),
	};
}

/**
 * A timeline track is as wide as the whole virtual timeline, so its geometric
 * center sits far outside the window. Drop a little way into the visible part
 * of the track instead.
 */
async function dropPointOnTrack({
	page,
}: {
	page: PageHandle;
}): Promise<{ x: number; y: number }> {
	const { box, viewport } = await visibleBox({
		page,
		testId: "timeline-track",
	});
	const visibleLeft = Math.max(box.x, 0);
	const visibleRight = Math.min(box.x + box.width, viewport.width);
	if (visibleRight <= visibleLeft) {
		throw new Error("timeline-track is not visible inside the viewport");
	}
	return {
		x: Math.round(Math.min(visibleLeft + 160, visibleRight - 20)),
		y: Math.round(box.y + box.height / 2),
	};
}

function readTimeline(page: PageHandle) {
	return page.evaluate((): TimelineSummary => {
		const store = (
			window as unknown as {
				__timelineStore: {
					getState: () => {
						tracks: Array<{
							elements: Array<{ type?: string; mediaId?: string }>;
						}>;
						selectedElements?: unknown[];
					};
				};
			}
		).__timelineStore.getState();
		const elements = store.tracks.flatMap((track) => track.elements);
		return {
			tracks: store.tracks.length,
			elements: elements.length,
			mediaElements: elements.filter((element) => element.type === "media")
				.length,
			selectedElements:
				(store as unknown as { selectedElements?: unknown[] }).selectedElements
					?.length ?? 0,
		};
	});
}

isolatedElectronTest.describe("Agent pointer HTML5 drag-and-drop", () => {
	isolatedElectronTest(
		"drops a media item, hit-tests it, multi-selects, zooms, drops a file, and survives page zoom through the CLI",
		async ({ page, apiPort, electronApp }) => {
			isolatedElectronTest.setTimeout(180_000);
			await createTestProject(page, "Pointer HTML5 Drag");
			await importTestVideo(page);

			const from = await centerOf({ page, testId: "media-item" });
			const to = await dropPointOnTrack({ page });
			const before = await readTimeline(page);
			expect(before.elements).toBe(0);

			const evidence = await runQCutPipelineCli({
				apiPort,
				args: [
					"editor:pointer:drag",
					"--from-x",
					String(from.x),
					"--from-y",
					String(from.y),
					"--to-x",
					String(to.x),
					"--to-y",
					String(to.y),
					"--dnd",
					"html5",
					"--force",
				],
			});
			const evidenceDirectory = resolve(
				"output/playwright/agent-pointer-html5-drag"
			);
			await mkdir(evidenceDirectory, { recursive: true });
			await writeFile(
				resolve(evidenceDirectory, "cli-envelopes.json"),
				JSON.stringify(evidence.envelopes, null, 2)
			);
			const envelope = evidence.envelopes.find(
				(candidate) => candidate.status === "ok"
			);
			const envelopeText = JSON.stringify(evidence.envelopes);
			expect(envelope?.status, envelopeText).toBe("ok");
			// The CLI wraps editor responses as data.{schema_version, command, data}.
			const data = (
				envelope?.data as { data?: PointerDragEnvelopeData } | undefined
			)?.data;
			expect(data?.action, envelopeText).toBe("drag");
			expect(data?.inputMode).toBe("background");
			expect(data?.dnd).toMatchObject({
				mode: "html5",
				intercepted: true,
				backend: "cdp-dispatch-drag-event",
			});
			expect(data?.dnd?.mimeTypes).toContain("application/x-media-item");

			await expect(
				page.locator('[data-testid="timeline-element"]')
			).toHaveCount(1, { timeout: 10_000 });
			const after = await readTimeline(page);
			expect(after.elements).toBe(1);
			expect(after.mediaElements).toBe(1);

			await page.screenshot({
				path: resolve(evidenceDirectory, "after-drop.png"),
			});

			// Hit-test: the point where the clip landed must resolve to the clip.
			const firstClip = await clipBox({ page, index: 0 });
			const hitEnvelope = await runPointer({
				apiPort,
				args: [
					"editor:pointer:hit-test",
					"--x",
					String(firstClip.center.x),
					"--y",
					String(firstClip.center.y),
				],
			});
			const hit = editorData<PointerHitTestData>(hitEnvelope);
			expect(hit?.hit, JSON.stringify(hit)).toBe(true);
			const hitTestIds = [
				hit?.element?.testId ?? null,
				...(hit?.ancestors ?? []).map((ancestor) => ancestor.testId),
			];
			expect(hitTestIds, JSON.stringify(hit)).toContain("timeline-element");

			// Modifier click: select the clip, duplicate it with cmd+d, then
			// shift-click the copy so both are selected.
			await runPointer({
				apiPort,
				args: [
					"editor:pointer:click",
					"--x",
					String(firstClip.center.x),
					"--y",
					String(firstClip.center.y),
					"--force",
				],
			});
			await runPointer({
				apiPort,
				args: ["editor:keyboard:press", "--keys", "cmd+d", "--force"],
			});
			await expect(
				page.locator('[data-testid="timeline-element"]')
			).toHaveCount(2, { timeout: 10_000 });
			const clipA = await clipBox({ page, index: 0 });
			const clipB = await clipBox({ page, index: 1 });
			await runPointer({
				apiPort,
				args: [
					"editor:pointer:click",
					"--x",
					String(clipA.center.x),
					"--y",
					String(clipA.center.y),
					"--force",
				],
			});
			expect((await readTimeline(page)).selectedElements).toBe(1);
			const shiftClick = await runPointer({
				apiPort,
				args: [
					"editor:pointer:click",
					"--x",
					String(clipB.center.x),
					"--y",
					String(clipB.center.y),
					"--modifiers",
					"shift",
					"--force",
				],
			});
			expect(
				editorData<{ modifiers?: string[] }>(shiftClick)?.modifiers
			).toEqual(["Shift"]);
			await expect
				.poll(async () => (await readTimeline(page)).selectedElements, {
					timeout: 5_000,
				})
				.toBe(2);

			// Modifier wheel: ctrl + wheel zooms the timeline, so the clip gets wider.
			const widthBefore = clipA.box.width;
			const zoom = await runPointer({
				apiPort,
				args: [
					"editor:pointer:scroll",
					"--x",
					String(clipA.center.x),
					"--y",
					String(clipA.center.y),
					"--delta-y",
					"-120",
					"--modifiers",
					"ctrl",
				],
			});
			expect(editorData<{ modifiers?: string[] }>(zoom)?.modifiers).toEqual([
				"Control",
			]);
			await expect
				.poll(async () => (await clipBox({ page, index: 0 })).box.width, {
					timeout: 5_000,
				})
				.toBeGreaterThan(widthBefore);
			const widthAfter = (await clipBox({ page, index: 0 })).box.width;

			await page.screenshot({
				path: resolve(evidenceDirectory, "after-multiselect-zoom.png"),
			});

			// External file drop: drop a PNG on the media library through CDP DragData.files.
			const mediaItemsBefore = await page
				.locator('[data-testid="media-item"]')
				.count();
			const library = await centerOf({ page, testId: "media-library-items" });
			const dropFiles = await runPointer({
				apiPort,
				args: [
					"editor:pointer:drop-files",
					"--files",
					resolve(
						process.cwd(),
						"apps/web/src/test/e2e/fixtures/media/sample-image.png"
					),
					"--x",
					String(library.x),
					"--y",
					String(library.y),
					"--force",
				],
			});
			expect(
				editorData<{ dnd?: { fileCount?: number } }>(dropFiles)?.dnd?.fileCount
			).toBe(1);
			await expect(page.locator('[data-testid="media-item"]')).toHaveCount(
				mediaItemsBefore + 1,
				{ timeout: 15_000 }
			);
			const mediaNames = await page.evaluate(() =>
				(
					window as unknown as {
						__mediaStore: {
							getState: () => { mediaItems: Array<{ name?: string }> };
						};
					}
				).__mediaStore
					.getState()
					.mediaItems.map((item) => item.name ?? "")
			);
			expect(mediaNames).toContain("sample-image.png");

			// Page zoom: pointer coordinates stay in CSS pixels, so a hit-test at
			// the zoomed clip's CSS center still resolves to the clip.
			await electronApp.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25);
			});
			await page.waitForTimeout(300);
			const zoomedClip = await clipBox({ page, index: 0 });
			const zoomedHit = editorData<PointerHitTestData>(
				await runPointer({
					apiPort,
					args: [
						"editor:pointer:hit-test",
						"--x",
						String(zoomedClip.center.x),
						"--y",
						String(zoomedClip.center.y),
					],
				})
			);
			const zoomedTestIds = [
				zoomedHit?.element?.testId ?? null,
				...(zoomedHit?.ancestors ?? []).map((ancestor) => ancestor.testId),
			];
			expect(zoomedTestIds, JSON.stringify(zoomedHit)).toContain(
				"timeline-element"
			);
			await electronApp.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1);
			});
			await writeFile(
				resolve(evidenceDirectory, "cli-envelope.json"),
				JSON.stringify(
					{
						from,
						to,
						before,
						after,
						envelope,
						hit,
						selectedAfterShiftClick: (await readTimeline(page))
							.selectedElements,
						widthBefore,
						widthAfter,
						mediaItemsBefore,
						mediaItemsAfter: mediaNames.length,
						mediaNames,
						zoomedHit,
					},
					null,
					2
				)
			);
		}
	);
});
