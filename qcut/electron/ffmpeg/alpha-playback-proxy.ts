/**
 * Browser-playable stand-ins for transparent videos Chromium cannot decode.
 *
 * The preview's video element and the renderer export's WebCodecs decoder
 * play VP8 and VP9 with alpha, but not ProRes 4444, QuickTime Animation or
 * PNG in MOV: the clip vanished from both. For such a source FFmpeg writes a
 * VP9 WebM with its alpha (`yuva420p`, `alpha_mode=1`), its frame timing and
 * its sound, and the preview and the renderer export read that file; the
 * native export keeps reading the original. Proxies live in the project's
 * cache folder, named after the source's path, size and modification time,
 * so an edited source gets a new one. Colours use FFmpeg's own conversion,
 * the one the native export composites with, so both engines agree.
 *
 * @module electron/ffmpeg/alpha-playback-proxy
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { getFFmpegPath } from "./paths.js";
import type { AlphaPlaybackProxyResult } from "./types.js";
import type { VideoAlphaInfo } from "./video-alpha.js";
import { probeVideoAlpha } from "./video-alpha-probe.js";

/** Bump to rebuild every proxy after a change to the encoding below. */
export const ALPHA_PROXY_VERSION = 1;

/** Codecs whose alpha the browser decodes itself. */
const BROWSER_ALPHA_CODECS = new Set(["vp8", "vp9"]);

export function needsAlphaPlaybackProxy({
	alpha,
}: {
	alpha: VideoAlphaInfo | null;
}): boolean {
	return (
		Boolean(alpha?.hasAlpha) && !BROWSER_ALPHA_CODECS.has(alpha?.codec ?? "")
	);
}

/** The proxy's file name for this version of the source file. */
export function alphaPlaybackProxyFileName({
	sourcePath,
	size,
	modifiedAt,
}: {
	sourcePath: string;
	size: number;
	modifiedAt: number;
}): string {
	const key = `${ALPHA_PROXY_VERSION}\u0000${sourcePath}\u0000${size}\u0000${modifiedAt}`;
	return `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.webm`;
}

/**
 * VP9 with alpha at near-transparent quality, every source frame kept at its
 * own time, and the first audio stream (if any) as Opus.
 */
export function buildAlphaPlaybackProxyArgs({
	sourcePath,
	outputPath,
}: {
	sourcePath: string;
	outputPath: string;
}): string[] {
	return [
		"-y",
		"-v",
		"error",
		"-i",
		sourcePath,
		"-map",
		"0:v:0",
		"-map",
		"0:a:0?",
		"-fps_mode",
		"passthrough",
		"-c:v",
		"libvpx-vp9",
		"-pix_fmt",
		"yuva420p",
		"-crf",
		"12",
		"-b:v",
		"0",
		"-deadline",
		"good",
		"-cpu-used",
		"4",
		"-row-mt",
		"1",
		"-auto-alt-ref",
		"0",
		"-c:a",
		"libopus",
		"-b:a",
		"160k",
		"-f",
		"webm",
		outputPath,
	];
}

function runFFmpeg({ args }: { args: string[] }): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(getFFmpegPath(), args, {
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-4000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`FFmpeg exited with ${code}: ${stderr.trim()}`));
		});
	});
}

const pendingProxies = new Map<string, Promise<void>>();

/**
 * The source's alpha facts and, when the browser cannot decode it, the path
 * of its proxy in `cacheDir`, writing the proxy first if it does not exist.
 * Concurrent calls for one source share one encode.
 */
export async function ensureAlphaPlaybackProxy({
	sourcePath,
	cacheDir,
	probe = probeVideoAlpha,
	encode = runFFmpeg,
}: {
	sourcePath: string;
	cacheDir: string;
	probe?: typeof probeVideoAlpha;
	encode?: typeof runFFmpeg;
}): Promise<AlphaPlaybackProxyResult> {
	const alpha = await probe({ mediaPath: sourcePath });
	if (!needsAlphaPlaybackProxy({ alpha })) return { alpha };
	const stats = await fsPromises.stat(sourcePath);
	const proxyPath = path.join(
		cacheDir,
		alphaPlaybackProxyFileName({
			sourcePath,
			size: stats.size,
			modifiedAt: stats.mtimeMs,
		})
	);
	let pending = pendingProxies.get(proxyPath);
	if (!pending) {
		pending = (async () => {
			try {
				const existing = await fsPromises.stat(proxyPath);
				if (existing.size > 0) return;
			} catch {
				// Not written yet.
			}
			await fsPromises.mkdir(cacheDir, { recursive: true });
			// Written under a temporary name so a half-written proxy is never read.
			const partialPath = `${proxyPath}.partial-${process.pid}-${Date.now()}`;
			try {
				await encode({
					args: buildAlphaPlaybackProxyArgs({
						sourcePath,
						outputPath: partialPath,
					}),
				});
				await fsPromises.rename(partialPath, proxyPath);
			} catch (error) {
				await fsPromises.rm(partialPath, { force: true });
				throw error;
			}
		})();
		pendingProxies.set(proxyPath, pending);
		void pending.then(
			() => pendingProxies.delete(proxyPath),
			() => pendingProxies.delete(proxyPath)
		);
	}
	await pending;
	return { alpha, proxyPath };
}
