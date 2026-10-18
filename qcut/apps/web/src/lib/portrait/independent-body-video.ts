import type { MediaItem } from "@/stores/media/media-store-types";
import type {
	BeautyLabIndependentFrameRequest,
	BeautyLabIndependentSequenceFrameResult,
} from "@/types/electron";
import type { MediaElement, MediaPortraitAdjustments } from "@/types/timeline";
import { SequentialVideoRegistry } from "@/lib/export/export-sequential-video-source";
import { getExportFrameSampleTime } from "@/lib/export/export-video-frame-seek";
import {
	getMediaSourcePlaybackTime,
	mapMediaTimelineTime,
} from "@/lib/video/video-timing";

/** The engine steps at most 0.1 s between frames; faster rates stay well within it. */
export const INDEPENDENT_BODY_VIDEO_MIN_FPS = 10;
export const INDEPENDENT_BODY_VIDEO_MAX_FPS = 240;
const CAPABILITY_TTL_MS = 60_000;

/**
 * The clip a body-video session follows. Frame j of the clip is the frame at
 * clip-local time j / fps, whatever the clip's position on the timeline.
 */
export interface IndependentBodyVideoClip {
	element: MediaElement;
	mediaItem: MediaItem;
	fps: number;
}

export interface IndependentBodyVideoFrame {
	clip: IndependentBodyVideoClip;
	frame: number;
}

let capability: { checkedAt: number; available: Promise<boolean> } | undefined;

/** Whether the installed engine can follow a clip's body history (its video policy asset). */
export function independentBodyVideoCapability({
	now = Date.now(),
}: {
	now?: number;
} = {}): Promise<boolean> {
	if (!capability || now - capability.checkedAt > CAPABILITY_TTL_MS) {
		const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
		capability = {
			checkedAt: now,
			available: inspect
				? inspect().then(
						(status) => status.bodyVideo === true,
						() => false
					)
				: Promise.resolve(false),
		};
	}
	return capability.available;
}

export function resetIndependentBodyVideoCapability() {
	capability = undefined;
}

/** A video clip whose independent edit moves the body: its frames share one history. */
export function independentBodyVideoApplies({
	adjustments,
	mediaType,
	fps,
}: {
	adjustments?: MediaPortraitAdjustments;
	mediaType?: string;
	fps: number;
}) {
	return Boolean(
		adjustments?.enabled &&
			adjustments.engine === "independent" &&
			mediaType === "video" &&
			Number.isFinite(fps) &&
			fps >= INDEPENDENT_BODY_VIDEO_MIN_FPS &&
			fps <= INDEPENDENT_BODY_VIDEO_MAX_FPS &&
			Object.entries(adjustments.values).some(
				([key, value]) => key.startsWith("body_adjust_") && (value ?? 0) !== 0
			)
	);
}

export function independentBodyVideoFrameCount({
	clip,
}: {
	clip: IndependentBodyVideoClip;
}) {
	const { timelineDuration } = mapMediaTimelineTime({
		element: clip.element,
		localTimelineTime: 0,
		fps: clip.fps,
	});
	return Math.max(1, Math.ceil(timelineDuration * clip.fps - 1e-6));
}

/** The clip frame shown at a timeline time; before the clip its first frame, after it its last. */
export function independentBodyVideoFrameIndex({
	clip,
	timelineTime,
}: {
	clip: IndependentBodyVideoClip;
	timelineTime: number;
}) {
	const frame = Math.round((timelineTime - clip.element.startTime) * clip.fps);
	return Math.min(
		independentBodyVideoFrameCount({ clip }) - 1,
		Math.max(0, frame)
	);
}

/** Source time of clip frame `frame`, sampled as the export samples it. */
export function independentBodyVideoSourceTime({
	clip,
	frame,
}: {
	clip: IndependentBodyVideoClip;
	frame: number;
}) {
	return getMediaSourcePlaybackTime({
		element: clip.element,
		localTimelineTime: getExportFrameSampleTime({
			frameRate: clip.fps,
			frameStartTime: frame / clip.fps,
		}),
		fps: clip.fps,
	});
}

async function sha256Hex({ text }: { text: string }) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text)
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Names the clip for the engine's session: its media file, the timing that
 * maps clip frames to source frames, the frame rate and the edit as the clip
 * defines it. Moving the clip on the timeline keeps the identity.
 */
export async function independentBodyVideoClipIdentity({
	clip,
}: {
	clip: IndependentBodyVideoClip;
}) {
	const { element, mediaItem, fps } = clip;
	return sha256Hex({
		text: JSON.stringify({
			schemaVersion: 1,
			mediaId: mediaItem.id,
			file: {
				name: mediaItem.file?.name ?? null,
				size: mediaItem.file?.size ?? null,
				lastModified: mediaItem.file?.lastModified ?? null,
			},
			fps,
			duration: element.duration,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			playbackRate: element.playbackRate ?? 1,
			speedKeyframes: element.speedKeyframes ?? [],
			reverse: element.reverse ?? false,
			freezeFrameTime: element.freezeFrameTime ?? null,
			freezeFrameDuration: element.freezeFrameDuration ?? 0,
			portraitAdjustments: element.portraitAdjustments ?? null,
		}),
	});
}

/**
 * Decodes the clip's frames at the processing size the way the export does:
 * one sequential decoder over the media file, each frame drawn once into a
 * canvas of the processing size. The frames a paused preview submits are
 * therefore the bytes the export submits.
 */
export function createIndependentBodyVideoDecoder({
	clip,
}: {
	clip: IndependentBodyVideoClip;
}) {
	const registry = new SequentialVideoRegistry();
	let canvas: HTMLCanvasElement | undefined;
	async function frame({
		frame,
		width,
		height,
		signal,
	}: {
		frame: number;
		width: number;
		height: number;
		signal?: AbortSignal;
	}) {
		signal?.throwIfAborted();
		const source = await registry.getOrOpen(
			clip.mediaItem,
			"independent-body-video",
			{ signal }
		);
		if (!source) throw new Error("自研美体视频需要可顺序解码的本地视频素材");
		const decoded = await source.frameAt(
			independentBodyVideoSourceTime({ clip, frame })
		);
		signal?.throwIfAborted();
		if (!decoded || decoded.canvas.width <= 0 || decoded.canvas.height <= 0)
			throw new Error(`自研美体视频在第 ${frame} 帧没有解出画面`);
		canvas ??= document.createElement("canvas");
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("Unable to read body video frame pixels");
		context.clearRect(0, 0, width, height);
		context.drawImage(decoded.canvas as CanvasImageSource, 0, 0, width, height);
		const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
		for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
		return rgba;
	}
	async function dispose() {
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
		await registry.disposeAll();
	}
	return { frame, dispose };
}

/**
 * Renders clip frame k with its history. The engine answers a frame whose
 * history it lacks with the frame to resume from; the frames in between are
 * then decoded and submitted in order before k is asked for again. The
 * returned pixels are opaque and at the processing size.
 */
export async function renderIndependentBodyVideoFrame({
	frame: { clip, frame },
	width,
	height,
	adjustments,
	signal,
	createDecoder = createIndependentBodyVideoDecoder,
}: {
	frame: IndependentBodyVideoFrame;
	width: number;
	height: number;
	adjustments: BeautyLabIndependentFrameRequest["adjustments"];
	signal?: AbortSignal;
	createDecoder?: typeof createIndependentBodyVideoDecoder;
}): Promise<Uint8Array> {
	const api = window.electronAPI?.beautyLab;
	if (!api?.renderIndependentSequenceFrame)
		throw new Error("自研美体视频需要 QCut 桌面版");
	const render = api.renderIndependentSequenceFrame;
	const identity = await independentBodyVideoClipIdentity({ clip });
	const decoder = createDecoder({ clip });
	try {
		const submit = async ({
			index,
			replay,
		}: {
			index: number;
			replay: boolean;
		}): Promise<BeautyLabIndependentSequenceFrameResult> => {
			const rgba = await decoder.frame({ frame: index, width, height, signal });
			signal?.throwIfAborted();
			const requestId = `body-video-${crypto.randomUUID()}`;
			const result = await render({
				requestId,
				width,
				height,
				rgba,
				adjustments,
				sequence: { clip: identity, frame: index, fps: clip.fps, replay },
			});
			signal?.throwIfAborted();
			if (result.requestId !== requestId)
				throw new Error("自研美颜返回了不匹配的画面");
			return result;
		};
		let result = await submit({ index: frame, replay: false });
		// A second gap means another clip took the engine meanwhile; one more
		// rebuild is reasonable, an endless chase is not.
		for (let attempt = 0; result.status === "replay"; attempt++) {
			if (attempt === 2) throw new Error("自研美体视频的历史状态无法重建");
			const from = result.from;
			if (!Number.isInteger(from) || from < 0 || from > frame)
				throw new Error("自研美体视频返回了无效的重放起点");
			for (let index = from; index < frame; index++) {
				const replayed = await submit({ index, replay: true });
				if (replayed.status !== "rendered")
					throw new Error("自研美体视频的历史状态无法重建");
			}
			result = await submit({ index: frame, replay: false });
		}
		if (
			result.width !== width ||
			result.height !== height ||
			result.rgba.byteLength !== width * height * 4
		)
			throw new Error("自研美颜返回了不匹配的画面");
		return result.rgba;
	} finally {
		await decoder.dispose();
	}
}
