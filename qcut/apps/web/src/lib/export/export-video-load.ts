const VIDEO_LOAD_TIMEOUT_MS = 15_000;

export function loadExportVideo({
	url,
	signal,
}: {
	url: string;
	signal?: AbortSignal;
}): Promise<HTMLVideoElement> {
	if (signal?.aborted) return Promise.reject(signal.reason);
	const video = document.createElement("video");
	video.crossOrigin = "anonymous";
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			clearTimeout(timeoutId);
			video.removeEventListener("loadeddata", onLoaded);
			video.removeEventListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
		};
		const fail = ({ error }: { error: unknown }) => {
			if (settled) return;
			settled = true;
			cleanup();
			video.removeAttribute("src");
			try {
				video.pause();
				video.load();
			} catch {
				// Preserve the load failure if the media element is already detached.
			}
			reject(error);
		};
		const onLoaded = () => {
			if (settled) return;
			if (video.videoWidth <= 0 || video.videoHeight <= 0) {
				fail({ error: new Error("Video loaded without a decoded frame") });
				return;
			}
			settled = true;
			cleanup();
			resolve(video);
		};
		const onError = () => fail({ error: new Error("Failed to load video") });
		const onAbort = () => fail({ error: signal?.reason });
		const timeoutId = setTimeout(
			() =>
				fail({
					error: new Error(
						`Video load timed out after ${VIDEO_LOAD_TIMEOUT_MS}ms`
					),
				}),
			VIDEO_LOAD_TIMEOUT_MS
		);
		video.addEventListener("loadeddata", onLoaded);
		video.addEventListener("error", onError);
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			signal?.throwIfAborted();
			video.src = url;
		} catch (error) {
			fail({ error });
		}
	});
}
