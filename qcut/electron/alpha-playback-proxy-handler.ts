/**
 * IPC for transparent videos the browser cannot decode: the renderer asks
 * for a file's alpha facts and, when it needs one, the VP9 alpha proxy it
 * plays and exports from (see ffmpeg/alpha-playback-proxy.ts).
 *
 * A proxy of project media goes into that project's cache folder; any other
 * file's into the temporary media folder. Both are served by `app://local-media`.
 *
 * @module electron/alpha-playback-proxy-handler
 */

import { app, ipcMain } from "electron";
import path from "node:path";
import { getProjectsRootPath } from "./claude/utils/helpers.js";
import { ensureAlphaPlaybackProxy } from "./ffmpeg/alpha-playback-proxy.js";
import type { AlphaPlaybackProxyResult } from "./ffmpeg/types.js";

export const ALPHA_PLAYBACK_PROXY_CHANNEL =
	"ffmpeg-ensure-alpha-playback-proxy";

/** Where the proxy of `sourcePath` is written. */
export function alphaPlaybackProxyCacheDir({
	sourcePath,
	projectsRoot,
	tempRoot,
}: {
	sourcePath: string;
	projectsRoot: string;
	tempRoot: string;
}): string {
	const relative = path.relative(projectsRoot, path.resolve(sourcePath));
	const [projectFolder] = relative.split(path.sep);
	if (
		projectFolder &&
		!relative.startsWith("..") &&
		!path.isAbsolute(relative) &&
		relative.includes(path.sep)
	) {
		return path.join(projectsRoot, projectFolder, "cache", "alpha-proxies");
	}
	return path.join(tempRoot, "qcut-videos", "alpha-proxies");
}

export function setupAlphaPlaybackProxyHandlers(): void {
	ipcMain.handle(
		ALPHA_PLAYBACK_PROXY_CHANNEL,
		async (
			_event,
			options: { sourcePath?: unknown }
		): Promise<AlphaPlaybackProxyResult> => {
			const sourcePath = options?.sourcePath;
			if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
				throw new Error("An absolute source path is required");
			}
			return ensureAlphaPlaybackProxy({
				sourcePath,
				cacheDir: alphaPlaybackProxyCacheDir({
					sourcePath,
					projectsRoot: getProjectsRootPath(),
					tempRoot: app.getPath("temp"),
				}),
			});
		}
	);
}
