import { expect, type Page } from "@playwright/test";
import { CANVAS_PLAYBACK_CACHE_DIRECTORY } from "../../../lib/preview/canvas-composition-playback-cache";
import type { BodyOperationFrame } from "./body-video-operation-evidence";

/** Independently decodes every prepared PNG without touching the displayed canvas. */
export async function inspectBodyPlaybackCache({
	page,
	sessionId,
	reference,
}: {
	page: Page;
	sessionId: string | null;
	reference: BodyOperationFrame[];
}) {
	if (!sessionId || !/^(?:(?:v1|unmanaged)-)?[a-f0-9-]{36}$/i.test(sessionId))
		throw new Error("Missing prepared playback cache identity");
	const result = await page.evaluate(
		async ({ directoryName, sessionId, frames }) => {
			const root = await navigator.storage.getDirectory();
			const parent = await root.getDirectoryHandle(directoryName);
			const directory = await parent.getDirectoryHandle(sessionId);
			const canvas = document.createElement("canvas");
			canvas.width = 1080;
			canvas.height = 1920;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context)
				throw new Error("Missing playback cache inspection context");
			const hashes: Array<{
				frame: number;
				rgbaSha256: string;
				pngBytes: number;
			}> = [];
			try {
				await Array.from({ length: frames }, (_, frame) => frame).reduce(
					async (previous, frame) => {
						await previous;
						const file = await directory.getFileHandle(`${frame}.png`);
						const blob = await file.getFile();
						const bitmap = await createImageBitmap(blob);
						try {
							if (bitmap.width !== 1080 || bitmap.height !== 1920)
								throw new Error(`Incorrect cache dimensions at ${frame}`);
							context.clearRect(0, 0, canvas.width, canvas.height);
							context.drawImage(bitmap, 0, 0);
							const rgba = context.getImageData(
								0,
								0,
								canvas.width,
								canvas.height
							).data;
							const digest = await crypto.subtle.digest("SHA-256", rgba);
							hashes.push({
								frame,
								rgbaSha256: Array.from(new Uint8Array(digest), (byte) =>
									byte.toString(16).padStart(2, "0")
								).join(""),
								pngBytes: blob.size,
							});
						} finally {
							bitmap.close();
						}
					},
					Promise.resolve()
				);
				return hashes;
			} finally {
				canvas.width = 0;
				canvas.height = 0;
			}
		},
		{
			directoryName: CANVAS_PLAYBACK_CACHE_DIRECTORY,
			sessionId,
			frames: reference.length,
		}
	);
	expect(result).toHaveLength(reference.length);
	for (const entry of result)
		expect(entry.rgbaSha256, `Prepared cache frame ${entry.frame}`).toBe(
			reference[entry.frame].rgbaSha256
		);
	return {
		sessionId,
		frames: result,
		pngBytes: result.reduce((sum, frame) => sum + frame.pngBytes, 0),
	};
}
