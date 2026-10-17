/**
 * Transparent videos the browser cannot decode — ProRes 4444, QuickTime
 * Animation, PNG in MOV — play in the preview and the renderer export from a
 * VP9 alpha proxy the desktop app writes into the project's cache
 * (electron/ffmpeg/alpha-playback-proxy.ts). The original stays the clip's
 * source, and the native export reads it directly.
 */

import { type PlatformFFmpegAPI, platform } from "@qcut/platform-core";
import { debugWarn } from "@/lib/debug/debug-config";
import { localMediaUrlForPath } from "./media-source";

export interface MediaAlphaInfo {
	hasAlpha: boolean;
	codec: string;
	pixelFormat: string;
	alphaMode: number;
	/** The VP9 alpha WebM the browser plays instead, when it needs one. */
	proxyPath?: string;
}

const inspections = new Map<string, Promise<MediaAlphaInfo | null>>();

/**
 * The desktop app's alpha verdict on a video file, writing its proxy first
 * when the browser needs one. Asked once per path; null outside the desktop
 * app, for a file without video, or when the file cannot be read.
 */
export function inspectMediaAlpha({
	localPath,
}: {
	localPath?: string;
}): Promise<MediaAlphaInfo | null> {
	if (!localPath) return Promise.resolve(null);
	const known = inspections.get(localPath);
	if (known) return known;
	let ensure: PlatformFFmpegAPI["ensureAlphaPlaybackProxy"];
	try {
		const desktop = platform();
		if (desktop.isElectron)
			ensure = desktop.ffmpeg?.ensureAlphaPlaybackProxy?.bind(desktop.ffmpeg);
	} catch {
		// No platform bridge (tests, a bare web build): nothing to ask.
	}
	if (!ensure) return Promise.resolve(null);
	const pending = ensure({ sourcePath: localPath }).then((result) =>
		result?.alpha
			? {
					hasAlpha: result.alpha.hasAlpha,
					codec: result.alpha.codec,
					pixelFormat: result.alpha.pixelFormat,
					alphaMode: result.alpha.alphaMode,
					...(result.proxyPath ? { proxyPath: result.proxyPath } : {}),
				}
			: null
	);
	inspections.set(localPath, pending);
	pending.catch((error: unknown) => {
		inspections.delete(localPath);
		debugWarn("[AlphaPlaybackProxy] inspection failed", localPath, error);
	});
	return pending;
}

/** The alpha facts recorded on a media item, if any. */
export function mediaAlphaInfo(mediaItem: {
	metadata?: Record<string, unknown>;
}): MediaAlphaInfo | undefined {
	const alpha = mediaItem.metadata?.alpha;
	return alpha && typeof alpha === "object"
		? (alpha as MediaAlphaInfo)
		: undefined;
}

/**
 * The proxy a video item decodes from, asking the desktop app when the item
 * does not record one yet (an export right after import).
 */
export async function resolveAlphaPlaybackProxyUrl(mediaItem: {
	type?: string;
	localPath?: string;
	metadata?: Record<string, unknown>;
}): Promise<string | undefined> {
	if (mediaItem.type !== "video") return;
	const recorded = mediaAlphaInfo(mediaItem);
	const alpha =
		recorded ?? (await inspectMediaAlpha(mediaItem).catch(() => null));
	return alpha?.proxyPath ? localMediaUrlForPath(alpha.proxyPath) : undefined;
}

/**
 * Asks the desktop app about a video item, hands the answer to `update` to
 * record on the item, and returns the item's proxy as a File when it has one,
 * for thumbnails and durations the browser cannot read from the original.
 * With `readProxy` false (a project load that already has its thumbnails)
 * only the answer is recorded and the proxy is not read.
 */
export async function recordMediaAlpha({
	mediaItem,
	update,
	readProxy = true,
}: {
	mediaItem: {
		type?: string;
		name: string;
		localPath?: string;
	};
	update: (alpha: MediaAlphaInfo) => void;
	readProxy?: boolean;
}): Promise<File | null> {
	if (mediaItem.type !== "video") return null;
	const alpha = await inspectMediaAlpha(mediaItem).catch(() => null);
	if (!alpha) return null;
	update(alpha);
	if (!alpha.proxyPath || !readProxy) return null;
	try {
		const response = await fetch(localMediaUrlForPath(alpha.proxyPath));
		if (!response.ok) return null;
		return new File([await response.blob()], `${mediaItem.name}.webm`, {
			type: "video/webm",
		});
	} catch (error) {
		debugWarn("[AlphaPlaybackProxy] proxy read failed", alpha.proxyPath, error);
		return null;
	}
}

/** Test hook: forget earlier verdicts. */
export function clearMediaAlphaInspections(): void {
	inspections.clear();
}
