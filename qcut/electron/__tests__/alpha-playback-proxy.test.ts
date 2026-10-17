import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
	ipcMain: { handle: vi.fn() },
}));

import { alphaPlaybackProxyCacheDir } from "../alpha-playback-proxy-handler";
import {
	alphaPlaybackProxyFileName,
	buildAlphaPlaybackProxyArgs,
	ensureAlphaPlaybackProxy,
	needsAlphaPlaybackProxy,
} from "../ffmpeg/alpha-playback-proxy";
import { videoAlphaFromStream } from "../ffmpeg/video-alpha";

const qtrle = videoAlphaFromStream({
	stream: { codec_name: "qtrle", pix_fmt: "argb" },
});
const vp9 = videoAlphaFromStream({
	stream: { codec_name: "vp9", pix_fmt: "yuv420p", tags: { alpha_mode: "1" } },
});
const h264 = videoAlphaFromStream({
	stream: { codec_name: "h264", pix_fmt: "yuv420p" },
});

describe("needsAlphaPlaybackProxy", () => {
	it("asks for a proxy only for alpha the browser cannot decode", () => {
		expect(needsAlphaPlaybackProxy({ alpha: qtrle })).toBe(true);
		expect(
			needsAlphaPlaybackProxy({
				alpha: videoAlphaFromStream({
					stream: { codec_name: "prores", pix_fmt: "yuva444p12le" },
				}),
			})
		).toBe(true);
		expect(needsAlphaPlaybackProxy({ alpha: vp9 })).toBe(false);
		expect(needsAlphaPlaybackProxy({ alpha: h264 })).toBe(false);
		expect(needsAlphaPlaybackProxy({ alpha: null })).toBe(false);
	});
});

describe("alphaPlaybackProxyFileName", () => {
	it("changes with the source's path, size and modification time", () => {
		const base = { sourcePath: "/p/a.mov", size: 10, modifiedAt: 1 };
		const name = alphaPlaybackProxyFileName(base);
		expect(name).toMatch(/^[0-9a-f]{32}\.webm$/);
		expect(alphaPlaybackProxyFileName(base)).toBe(name);
		expect(alphaPlaybackProxyFileName({ ...base, size: 11 })).not.toBe(name);
		expect(alphaPlaybackProxyFileName({ ...base, modifiedAt: 2 })).not.toBe(
			name
		);
		expect(
			alphaPlaybackProxyFileName({ ...base, sourcePath: "/p/b.mov" })
		).not.toBe(name);
	});
});

describe("buildAlphaPlaybackProxyArgs", () => {
	it("writes VP9 with alpha, keeping every frame's time and the sound", () => {
		const args = buildAlphaPlaybackProxyArgs({
			sourcePath: "/p/a.mov",
			outputPath: "/c/x.webm",
		});
		expect(args).toEqual(
			expect.arrayContaining([
				"libvpx-vp9",
				"yuva420p",
				"passthrough",
				"0:a:0?",
			])
		);
		expect(
			args.slice(
				args.indexOf("-auto-alt-ref"),
				args.indexOf("-auto-alt-ref") + 2
			)
		).toEqual(["-auto-alt-ref", "0"]);
		expect(args.at(-1)).toBe("/c/x.webm");
	});
});

describe("alphaPlaybackProxyCacheDir", () => {
	it("keeps a project's proxies in that project's cache", () => {
		expect(
			alphaPlaybackProxyCacheDir({
				sourcePath: "/Docs/QCut/Projects/abc/media/card.mov",
				projectsRoot: "/Docs/QCut/Projects",
				tempRoot: "/tmp",
			})
		).toBe(path.join("/Docs/QCut/Projects/abc/cache/alpha-proxies"));
	});

	it("puts any other file's proxy in the temporary media folder", () => {
		for (const sourcePath of [
			"/Users/me/card.mov",
			"/Docs/QCut/Projects/x.mov",
		]) {
			expect(
				alphaPlaybackProxyCacheDir({
					sourcePath,
					projectsRoot: "/Docs/QCut/Projects",
					tempRoot: "/tmp",
				})
			).toBe(path.join("/tmp/qcut-videos/alpha-proxies"));
		}
	});
});

describe("ensureAlphaPlaybackProxy", () => {
	let dir: string;
	let source: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-alpha-proxy-"));
		source = path.join(dir, "card.mov");
		fs.writeFileSync(source, "source");
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("answers without a proxy for alpha the browser decodes", async () => {
		const encode = vi.fn();
		await expect(
			ensureAlphaPlaybackProxy({
				sourcePath: source,
				cacheDir: path.join(dir, "cache"),
				probe: async () => vp9,
				encode,
			})
		).resolves.toEqual({ alpha: vp9 });
		expect(encode).not.toHaveBeenCalled();
	});

	it("encodes one proxy for concurrent requests and reuses it after", async () => {
		const encode = vi.fn(async ({ args }: { args: string[] }) => {
			fs.writeFileSync(args.at(-1) as string, "proxy");
		});
		const request = () =>
			ensureAlphaPlaybackProxy({
				sourcePath: source,
				cacheDir: path.join(dir, "cache"),
				probe: async () => qtrle,
				encode,
			});
		const [first, second] = await Promise.all([request(), request()]);
		expect(first).toEqual(second);
		expect(first.alpha).toBe(qtrle);
		expect(fs.readFileSync(first.proxyPath as string, "utf8")).toBe("proxy");
		await request();
		expect(encode).toHaveBeenCalledTimes(1);
		// Nothing half-written is left beside it.
		expect(fs.readdirSync(path.join(dir, "cache"))).toEqual([
			path.basename(first.proxyPath as string),
		]);
	});

	it("leaves no proxy behind when the encode fails", async () => {
		await expect(
			ensureAlphaPlaybackProxy({
				sourcePath: source,
				cacheDir: path.join(dir, "cache"),
				probe: async () => qtrle,
				encode: async ({ args }) => {
					fs.writeFileSync(args.at(-1) as string, "partial");
					throw new Error("encoder crashed");
				},
			})
		).rejects.toThrow("encoder crashed");
		expect(fs.readdirSync(path.join(dir, "cache"))).toEqual([]);
	});
});

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"alpha playback proxy with FFmpeg",
	() => {
		it("turns a QuickTime Animation clip into VP9 with the same frames and alpha", () => {
			const dir = fs.mkdtempSync(
				path.join(os.tmpdir(), "qcut-alpha-proxy-real-")
			);
			try {
				const source = path.join(dir, "card.mov");
				const proxy = path.join(dir, "card.webm");
				const make = spawnSync(ffmpegPath, [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=black@0:s=160x90:r=24:d=0.5,format=rgba,drawbox=x=40:y=20:w=80:h=50:color=white@1:t=fill:replace=1",
					"-c:v",
					"qtrle",
					"-pix_fmt",
					"argb",
					source,
				]);
				expect(make.status, make.stderr?.toString()).toBe(0);
				const encode = spawnSync(
					ffmpegPath,
					buildAlphaPlaybackProxyArgs({
						sourcePath: source,
						outputPath: proxy,
					})
				);
				expect(encode.status, encode.stderr?.toString()).toBe(0);
				const probe = spawnSync(
					ffprobePath,
					[
						"-v",
						"error",
						"-show_entries",
						"stream=codec_name:stream_tags=alpha_mode",
						"-of",
						"csv=p=0",
						proxy,
					],
					{ encoding: "utf8" }
				);
				expect(probe.stdout.trim()).toBe("vp9,1");
				const frames = spawnSync(
					ffmpegPath,
					[
						"-v",
						"error",
						"-c:v",
						"libvpx-vp9",
						"-i",
						proxy,
						"-f",
						"rawvideo",
						"-pix_fmt",
						"rgba",
						"-",
					],
					{ maxBuffer: 64 * 1024 * 1024 }
				).stdout;
				const frameSize = 160 * 90 * 4;
				expect(frames.length / frameSize).toBe(12);
				const alphaAt = (x: number, y: number) => frames[(y * 160 + x) * 4 + 3];
				expect(alphaAt(80, 45)).toBeGreaterThan(245);
				expect(alphaAt(10, 10)).toBeLessThan(10);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}, 30_000);
	}
);
