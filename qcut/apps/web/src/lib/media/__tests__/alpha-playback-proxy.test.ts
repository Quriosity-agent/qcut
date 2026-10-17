import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isElectron: true,
	ensure: vi.fn(),
}));

vi.mock("@qcut/platform-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@qcut/platform-core")>();
	return {
		...actual,
		platform: () => ({
			isElectron: mocks.isElectron,
			ffmpeg: { ensureAlphaPlaybackProxy: mocks.ensure },
		}),
	};
});

import {
	clearMediaAlphaInspections,
	inspectMediaAlpha,
	recordMediaAlpha,
	resolveAlphaPlaybackProxyUrl,
} from "../alpha-playback-proxy";
import { getVideoSource, localMediaUrlForPath } from "../media-source";

const qtrleAlpha = {
	codec: "qtrle",
	pixelFormat: "argb",
	alphaMode: 0,
	hasAlpha: true,
};

describe("alpha playback proxy (renderer)", () => {
	beforeEach(() => {
		clearMediaAlphaInspections();
		mocks.isElectron = true;
		mocks.ensure.mockReset();
	});

	it("asks the desktop app once per file and keeps the proxy path", async () => {
		mocks.ensure.mockResolvedValue({
			alpha: qtrleAlpha,
			proxyPath: "/Projects/p/cache/alpha-proxies/x.webm",
		});
		const [first, second] = await Promise.all([
			inspectMediaAlpha({ localPath: "/Projects/p/media/card.mov" }),
			inspectMediaAlpha({ localPath: "/Projects/p/media/card.mov" }),
		]);
		expect(first).toEqual({
			...qtrleAlpha,
			proxyPath: "/Projects/p/cache/alpha-proxies/x.webm",
		});
		expect(second).toBe(first);
		expect(mocks.ensure).toHaveBeenCalledOnce();
		expect(mocks.ensure).toHaveBeenCalledWith({
			sourcePath: "/Projects/p/media/card.mov",
		});
	});

	it("asks nothing without a file on disk or outside the desktop app", async () => {
		await expect(inspectMediaAlpha({})).resolves.toBeNull();
		mocks.isElectron = false;
		await expect(
			inspectMediaAlpha({ localPath: "/Projects/p/media/card.mov" })
		).resolves.toBeNull();
		expect(mocks.ensure).not.toHaveBeenCalled();
	});

	it("asks again after a failed inspection", async () => {
		mocks.ensure.mockRejectedValueOnce(new Error("ffprobe timeout"));
		await expect(
			inspectMediaAlpha({ localPath: "/media/card.mov" })
		).rejects.toThrow("ffprobe timeout");
		mocks.ensure.mockResolvedValueOnce({ alpha: qtrleAlpha });
		await expect(
			inspectMediaAlpha({ localPath: "/media/card.mov" })
		).resolves.toEqual(qtrleAlpha);
	});

	it("decodes a recorded proxy, and asks for one a video does not record", async () => {
		await expect(
			resolveAlphaPlaybackProxyUrl({
				type: "video",
				metadata: { alpha: { ...qtrleAlpha, proxyPath: "/cache/a.webm" } },
			})
		).resolves.toBe(localMediaUrlForPath("/cache/a.webm"));
		mocks.ensure.mockResolvedValue({
			alpha: qtrleAlpha,
			proxyPath: "/cache/b.webm",
		});
		await expect(
			resolveAlphaPlaybackProxyUrl({ type: "video", localPath: "/media/b.mov" })
		).resolves.toBe(localMediaUrlForPath("/cache/b.webm"));
		await expect(
			resolveAlphaPlaybackProxyUrl({ type: "image", localPath: "/media/c.png" })
		).resolves.toBeUndefined();
	});

	it("records the verdict without reading the proxy when asked not to", async () => {
		mocks.ensure.mockResolvedValue({
			alpha: qtrleAlpha,
			proxyPath: "/cache/c.webm",
		});
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const update = vi.fn();
		await expect(
			recordMediaAlpha({
				mediaItem: {
					type: "video",
					name: "card.mov",
					localPath: "/media/c.mov",
				},
				update,
				readProxy: false,
			})
		).resolves.toBeNull();
		expect(update).toHaveBeenCalledWith({
			...qtrleAlpha,
			proxyPath: "/cache/c.webm",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("plays a video from its proxy in the preview", () => {
		const file = new File(["x"], "card.mov");
		expect(
			getVideoSource({
				file,
				localPath: "/media/card.mov",
				metadata: { alpha: { ...qtrleAlpha, proxyPath: "/cache/a.webm" } },
			})
		).toEqual({
			file,
			type: "file",
			protocolSrc: localMediaUrlForPath("/cache/a.webm"),
		});
		expect(getVideoSource({ file, localPath: "/media/plain.mp4" })).toEqual({
			file,
			type: "file",
			protocolSrc: localMediaUrlForPath("/media/plain.mp4"),
		});
	});
});
