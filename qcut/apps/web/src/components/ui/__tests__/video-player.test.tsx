import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QCUT_VIDEO_FRAME_EVENT } from "@/lib/preview/preview-health-events";
import type { MediaElement } from "@/types/timeline";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import {
	getMediaSourcePlaybackTime,
	getMediaTimelineDuration,
	mapMediaTimelineTime,
} from "@/lib/video/video-timing";
import { VideoPlayer } from "../video-player";

vi.mock("@/stores/editor/playback-store", async () => {
	const { create } = await import("zustand");
	return {
		usePlaybackStore: create(() => ({
			currentTime: 0,
			isPlaying: false,
			speed: 1,
		})),
	};
});

vi.mock("@/lib/audio/use-media-audio-preview", () => ({
	useMediaAudioPreview: vi.fn(),
}));

function media({
	overrides = {},
}: {
	overrides?: Partial<MediaElement>;
} = {}): MediaElement {
	return {
		id: "video",
		type: "media",
		mediaId: "asset",
		name: "Video",
		startTime: 10,
		duration: 5,
		trimStart: 0,
		trimEnd: 0,
		playbackRate: 2,
		...overrides,
	};
}

describe("VideoPlayer", () => {
	beforeEach(() => {
		usePlaybackStore.setState({
			currentTime: 10.5,
			duration: 20,
			isPlaying: false,
			speed: 1,
		});
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("samples the same source frame as export without shifting timeline keyframes", () => {
		const element = media({ overrides: { playbackRate: 1 } });
		usePlaybackStore.setState({ currentTime: 11 });
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={0}
				trimEnd={0}
				clipDuration={element.duration}
				timingElement={element}
				frameRate={30}
			/>
		);
		const video = container.querySelector("video")!;
		fireEvent.loadedMetadata(video);
		expect(video.currentTime).toBeCloseTo(1 + 0.5 / 30, 8);
		expect(Math.floor(video.currentTime * (24_000 / 1001))).toBe(24);
		expect(usePlaybackStore.getState().currentTime).toBe(11);
		act(() => {
			window.dispatchEvent(
				new CustomEvent("playback-seek", { detail: { time: 11.5 } })
			);
		});
		expect(video.currentTime).toBeCloseTo(1.5 + 0.5 / 30, 8);
	});

	it("applies paused sampling before speed mapping and clamps incoming transition time", () => {
		const element = media();
		usePlaybackStore.setState({ currentTime: 9.8 });
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={0}
				trimEnd={0}
				clipDuration={element.duration}
				timingElement={element}
				frameRate={30}
				playbackWindow={{ startTime: 9.75, endTime: 10.25 }}
			/>
		);
		const video = container.querySelector("video")!;
		fireEvent.loadedMetadata(video);
		expect(video.currentTime).toBeCloseTo(1 / 30, 8);
		act(() => {
			usePlaybackStore.setState({ isPlaying: true });
			window.dispatchEvent(
				new CustomEvent("playback-seek", { detail: { time: 10.1 } })
			);
		});
		expect(video.currentTime).toBeCloseTo(0.2, 8);
	});

	it.each([
		24, 60,
	])("uses the same %ifps speed curve for position, rate and clip range", (fps) => {
		const element = media({
			overrides: {
				duration: 6,
				playbackRate: 1,
				speedKeyframes: [
					{ id: "slow", frame: 0, value: 1, easing: "linear" },
					{ id: "fast", frame: 60, value: 3, easing: "linear" },
				],
			},
		});
		usePlaybackStore.setState({ currentTime: 11, isPlaying: true });
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={0}
				trimEnd={0}
				clipDuration={element.duration}
				timingElement={element}
				frameRate={fps}
			/>
		);
		const video = container.querySelector("video")!;
		fireEvent.loadedMetadata(video);
		const timing = mapMediaTimelineTime({ element, localTimelineTime: 1, fps });
		expect(video.currentTime).toBeCloseTo(timing.sourceTime, 8);
		expect(video.playbackRate).toBeCloseTo(timing.playbackRate, 8);
		act(() => {
			window.dispatchEvent(
				new CustomEvent("playback-update", { detail: { time: 10.75 } })
			);
		});
		expect(video.playbackRate).toBeCloseTo(
			mapMediaTimelineTime({ element, localTimelineTime: 0.75, fps })
				.playbackRate,
			8
		);
		act(() => {
			usePlaybackStore.setState({ isPlaying: false });
		});
		expect(video.currentTime).toBeCloseTo(
			getMediaSourcePlaybackTime({
				element,
				localTimelineTime: 1 + 0.5 / fps,
				fps,
			}),
			8
		);
		const projectEnd = getMediaTimelineDuration(element, fps);
		const defaultEnd = getMediaTimelineDuration(element);
		const betweenEnds = element.startTime + (projectEnd + defaultEnd) / 2;
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		act(() => {
			usePlaybackStore.setState({ currentTime: betweenEnds, isPlaying: true });
		});
		fireEvent.canPlay(video);
		if (projectEnd > defaultEnd) {
			expect(play).toHaveBeenCalled();
		} else {
			expect(play).not.toHaveBeenCalled();
		}
	});

	it("restores clip time and speed after metadata resets the video", () => {
		const element = media();
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				clipPlaybackRate={element.playbackRate}
				timingElement={element}
			/>
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (!video) return;

		video.currentTime = 0;
		video.playbackRate = 1;
		fireEvent.loadedMetadata(video);

		expect(video.currentTime).toBeCloseTo(1, 4);
		expect(video.playbackRate).toBe(2);
	});

	it("holds the first source frame during an incoming transition preroll", () => {
		const element = media();
		usePlaybackStore.setState({ currentTime: 9.8 });
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				clipPlaybackRate={element.playbackRate}
				timingElement={element}
				playbackWindow={{ startTime: 9.75, endTime: 10.25 }}
			/>
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (!video) return;

		video.currentTime = 3;
		fireEvent.loadedMetadata(video);

		expect(video.currentTime).toBe(0);
	});

	it("maps a trimmed proxy back to proxy-relative media time", () => {
		const element = media({
			overrides: { duration: 10, trimStart: 2, playbackRate: 1 },
		});
		const { container } = render(
			<VideoPlayer
				videoSource={{
					type: "remote",
					src: "app://video-preview-proxy/proxy.mp4",
				}}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				clipPlaybackRate={element.playbackRate}
				timingElement={element}
				sourceTimeOffset={2}
			/>
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (!video) return;

		fireEvent.loadedMetadata(video);

		expect(video.currentTime).toBeCloseTo(0.5, 4);
	});

	it("marks a fallback frame as presented when frame callbacks are unavailable", () => {
		const element = media();
		const { container } = render(
			<VideoPlayer
				videoId="asset"
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				timingElement={element}
			/>
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (!video) return;

		fireEvent.loadedData(video);

		expect(video.dataset.qcutPresentedFrames).toBe("1");
		expect(Number(video.dataset.qcutPresentedAt)).toBeGreaterThan(0);
	});

	it("streams scrub seeks by holding the newest target until the seek settles", () => {
		const element = media();
		const { container } = render(
			<VideoPlayer
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				clipPlaybackRate={element.playbackRate}
				timingElement={element}
			/>
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (!video) return;

		const scrubSeek = (time: number, scrub = true) =>
			act(() => {
				window.dispatchEvent(
					new CustomEvent("playback-seek", { detail: { time, scrub } })
				);
			});

		// No seek in flight: a scrub seek applies immediately.
		scrubSeek(11);
		expect(video.currentTime).toBeCloseTo(2, 4);

		// While the decoder is still seeking, newer scrub targets are held
		// (latest wins) instead of cancelling the in-flight seek.
		Object.defineProperty(video, "seeking", {
			configurable: true,
			get: () => true,
		});
		scrubSeek(12);
		scrubSeek(12.5);
		expect(video.currentTime).toBeCloseTo(2, 4);

		Object.defineProperty(video, "seeking", {
			configurable: true,
			get: () => false,
		});
		fireEvent(video, new Event("seeked"));
		expect(video.currentTime).toBeCloseTo(5, 4);

		// A non-scrub seek (ruler/playhead) always applies immediately and
		// clears any held scrub target.
		Object.defineProperty(video, "seeking", {
			configurable: true,
			get: () => true,
		});
		scrubSeek(12);
		scrubSeek(11.5, false);
		expect(video.currentTime).toBeCloseTo(3, 4);
		fireEvent(video, new Event("seeked"));
		expect(video.currentTime).toBeCloseTo(3, 4);
	});

	it("resets frame timing across pause and resume", () => {
		const callbacks: VideoFrameRequestCallback[] = [];
		const requestDescriptor = Object.getOwnPropertyDescriptor(
			HTMLVideoElement.prototype,
			"requestVideoFrameCallback"
		);
		const cancelDescriptor = Object.getOwnPropertyDescriptor(
			HTMLVideoElement.prototype,
			"cancelVideoFrameCallback"
		);
		Object.defineProperty(
			HTMLVideoElement.prototype,
			"requestVideoFrameCallback",
			{
				configurable: true,
				value: vi.fn((callback: VideoFrameRequestCallback) => {
					callbacks.push(callback);
					return callbacks.length;
				}),
			}
		);
		Object.defineProperty(
			HTMLVideoElement.prototype,
			"cancelVideoFrameCallback",
			{
				configurable: true,
				value: vi.fn(),
			}
		);
		const presentedFrames: Array<{
			intervalMs: number | null;
			isActivePlaybackFrame: boolean;
		}> = [];
		const handleVideoFrame = (event: Event) => {
			const detail = (
				event as CustomEvent<{
					intervalMs: number | null;
					isActivePlaybackFrame: boolean;
				}>
			).detail;
			presentedFrames.push({
				intervalMs: detail.intervalMs,
				isActivePlaybackFrame: detail.isActivePlaybackFrame,
			});
		};
		window.addEventListener(QCUT_VIDEO_FRAME_EVENT, handleVideoFrame);
		act(() => {
			usePlaybackStore.setState({ currentTime: 10.5, isPlaying: true });
		});

		const element = media();
		const { unmount } = render(
			<VideoPlayer
				videoId="asset"
				videoSource={{ type: "remote", src: "https://fal.media/video.mp4" }}
				clipStartTime={element.startTime}
				trimStart={element.trimStart}
				trimEnd={element.trimEnd}
				clipDuration={element.duration}
				timingElement={element}
			/>
		);
		const presentLatestFrame = ({
			timestamp,
			mediaTime,
			presentedFrames,
		}: {
			timestamp: number;
			mediaTime: number;
			presentedFrames: number;
		}) => {
			const callback = callbacks.at(-1);
			if (!callback) throw new Error("Video frame callback was not registered");
			callback(timestamp, {
				mediaTime,
				presentedFrames,
			} as VideoFrameCallbackMetadata);
		};

		try {
			act(() => {
				presentLatestFrame({
					timestamp: 1_000,
					mediaTime: 0,
					presentedFrames: 1,
				});
				presentLatestFrame({
					timestamp: 1_016,
					mediaTime: 0.016,
					presentedFrames: 2,
				});
			});
			expect(presentedFrames).toEqual([
				{ intervalMs: null, isActivePlaybackFrame: true },
				{ intervalMs: 16, isActivePlaybackFrame: true },
			]);

			act(() => {
				usePlaybackStore.setState({ isPlaying: false });
			});
			act(() => {
				presentLatestFrame({
					timestamp: 4_000,
					mediaTime: 0.016,
					presentedFrames: 2,
				});
			});
			expect(presentedFrames).toEqual([
				{ intervalMs: null, isActivePlaybackFrame: true },
				{ intervalMs: 16, isActivePlaybackFrame: true },
				{ intervalMs: null, isActivePlaybackFrame: false },
			]);

			act(() => {
				usePlaybackStore.setState({ isPlaying: true });
			});
			act(() => {
				presentLatestFrame({
					timestamp: 5_000,
					mediaTime: 0.032,
					presentedFrames: 3,
				});
			});
			expect(presentedFrames).toEqual([
				{ intervalMs: null, isActivePlaybackFrame: true },
				{ intervalMs: 16, isActivePlaybackFrame: true },
				{ intervalMs: null, isActivePlaybackFrame: false },
				{ intervalMs: null, isActivePlaybackFrame: true },
			]);
		} finally {
			unmount();
			window.removeEventListener(QCUT_VIDEO_FRAME_EVENT, handleVideoFrame);
			if (requestDescriptor) {
				Object.defineProperty(
					HTMLVideoElement.prototype,
					"requestVideoFrameCallback",
					requestDescriptor
				);
			} else {
				Reflect.deleteProperty(
					HTMLVideoElement.prototype,
					"requestVideoFrameCallback"
				);
			}
			if (cancelDescriptor) {
				Object.defineProperty(
					HTMLVideoElement.prototype,
					"cancelVideoFrameCallback",
					cancelDescriptor
				);
			} else {
				Reflect.deleteProperty(
					HTMLVideoElement.prototype,
					"cancelVideoFrameCallback"
				);
			}
		}
	});
});
