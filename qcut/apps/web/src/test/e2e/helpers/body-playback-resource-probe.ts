import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { sampleMemory } from "./export-lifecycle-memory";
import { engineWorkers } from "./independent-body-video-helpers";
import { CANVAS_PLAYBACK_CACHE_DIRECTORY } from "../../../lib/preview/canvas-composition-playback-cache";

const run = promisify(execFile);
interface BitmapAccounting {
	created: number;
	closed: number;
	finalized: number;
	live: number;
	bytes: number;
	peakLive: number;
	peakBytes: number;
}

/** Counts explicit bitmap disposal without keeping bitmap objects alive. */
export async function installBodyBitmapAccounting({ page }: { page: Page }) {
	await page.addInitScript(() => {
		const target = window as unknown as {
			__bodyBitmapAccounting?: BitmapAccounting;
		};
		const counts: BitmapAccounting = {
			created: 0,
			closed: 0,
			finalized: 0,
			live: 0,
			bytes: 0,
			peakLive: 0,
			peakBytes: 0,
		};
		target.__bodyBitmapAccounting = counts;
		const allocated = new WeakMap<ImageBitmap, number>();
		const finalized = new FinalizationRegistry<number>((bytes) => {
			counts.finalized++;
			counts.live--;
			counts.bytes -= bytes;
		});
		const originalCreate = window.createImageBitmap;
		window.createImageBitmap = ((...args: unknown[]) =>
			(
				Reflect.apply(originalCreate, window, args) as Promise<ImageBitmap>
			).then((bitmap) => {
				const bytes = bitmap.width * bitmap.height * 4;
				allocated.set(bitmap, bytes);
				finalized.register(bitmap, bytes, bitmap);
				counts.created++;
				counts.live++;
				counts.bytes += bytes;
				counts.peakLive = Math.max(counts.peakLive, counts.live);
				counts.peakBytes = Math.max(counts.peakBytes, counts.bytes);
				return bitmap;
			})) as typeof createImageBitmap;
		const originalClose = ImageBitmap.prototype.close;
		ImageBitmap.prototype.close = function () {
			const bytes = allocated.get(this);
			if (bytes !== undefined) {
				allocated.delete(this);
				finalized.unregister(this);
				counts.closed++;
				counts.live--;
				counts.bytes -= bytes;
			}
			return originalClose.call(this);
		};
	});
}

export async function readBodyPlaybackResources({
	app,
	page,
	userDataDirectory,
	label,
}: {
	app: ElectronApplication;
	page: Page;
	userDataDirectory: string;
	label: string;
}) {
	const [processes, browser, workerPids, backendFiles] = await Promise.all([
		sampleMemory({ electronApp: app }),
		page.evaluate(async (directoryName) => {
			const root = await navigator.storage.getDirectory();
			const directories: Array<{ id: string; files: number; bytes: number }> =
				[];
			try {
				const parent = await root.getDirectoryHandle(directoryName);
				const entries: Array<[string, FileSystemHandle]> = [];
				for await (const entry of parent.entries()) entries.push(entry);
				await Promise.all(
					entries
						.filter(([, handle]) => handle.kind === "directory")
						.map(async ([id, handle]) => {
							const files: FileSystemFileHandle[] = [];
							for await (const child of (
								handle as FileSystemDirectoryHandle
							).values())
								if (child.kind === "file")
									files.push(child as FileSystemFileHandle);
							const sizes = await Promise.all(
								files.map(async (file) => (await file.getFile()).size)
							);
							directories.push({
								id,
								files: files.length,
								bytes: sizes.reduce((sum, value) => sum + value, 0),
							});
						})
				);
			} catch (error) {
				if (!(error instanceof DOMException) || error.name !== "NotFoundError")
					throw error;
			}
			const canvas = document.querySelector<HTMLCanvasElement>(
				'[data-testid="effect-playback-canvas"]'
			);
			return {
				opfs: directories,
				bitmap: (
					window as unknown as { __bodyBitmapAccounting?: BitmapAccounting }
				).__bodyBitmapAccounting,
				reader: canvas
					? {
							frames: Number(canvas.dataset.bufferedFrames),
							bytes: Number(canvas.dataset.bufferedBytes),
						}
					: null,
			};
		}, CANVAS_PLAYBACK_CACHE_DIRECTORY),
		engineWorkers({ appPid: app.process().pid ?? -1 }),
		readdir(
			path.join(userDataDirectory, "Cache", "independent-beauty-frames")
		).catch(() => [] as string[]),
	]);
	const [rss, backendSizes] = await Promise.all([
		workerPids.length
			? run("ps", ["-p", workerPids.join(","), "-o", "pid=,rss="]).then(
					({ stdout }) =>
						stdout
							.trim()
							.split("\n")
							.filter(Boolean)
							.map((line) => {
								const [pid, rssKb] = line.trim().split(/\s+/).map(Number);
								return { pid, rssKb };
							})
				)
			: Promise.resolve([]),
		Promise.all(
			backendFiles.map(
				async (file) =>
					(
						await stat(
							path.join(
								userDataDirectory,
								"Cache",
								"independent-beauty-frames",
								file
							)
						).catch(() => ({ size: 0 }))
					).size
			)
		),
	]);
	return {
		label,
		at: new Date().toISOString(),
		processes,
		workerRss: rss,
		backendCache: {
			files: backendFiles.length,
			bytes: backendSizes.reduce((sum, size) => sum + size, 0),
		},
		...browser,
	};
}

export async function readBodyPreparationMetrics({ page }: { page: Page }) {
	return page.getByTestId("effect-playback-status").evaluate((node) => {
		const data = (node as HTMLElement).dataset;
		return {
			renderMs: Number(data.renderMs),
			encodeMs: Number(data.encodeMs),
			writeMs: Number(data.writeMs),
			wallMs: Number(data.wallMs),
			completed: Number(data.completed),
			total: Number(data.total),
			generation: data.generation,
			sessionId: data.sessionId,
		};
	});
}
