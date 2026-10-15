import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "../audio-mix-settings";
import { DEFAULT_MEDIA_AUDIO_SETTINGS } from "../audio-properties";
import { renderBrowserTimelineAudio } from "../browser-audio-export";

vi.mock("../browser-audio-source-decoder", () => ({
	decodeBrowserAudioSource: vi.fn(async () => ({
		duration: 2,
		length: 96_000,
		numberOfChannels: 2,
		sampleRate: 48_000,
	})),
}));

// Two DynamicsCompressorNodes per clip, each 6 ms of lookahead at 48 kHz.
const LOOKAHEAD_FRAMES = 576;

function audioParam() {
	return {
		value: 0,
		cancelScheduledValues: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		setValueAtTime: vi.fn(),
	};
}

function audioNode() {
	return {
		buffer: null as unknown,
		connect: vi.fn(),
		delayTime: audioParam(),
		frequency: audioParam(),
		gain: audioParam(),
		knee: audioParam(),
		pan: audioParam(),
		playbackRate: audioParam(),
		Q: audioParam(),
		ratio: audioParam(),
		attack: audioParam(),
		release: audioParam(),
		threshold: audioParam(),
		start: vi.fn(),
		stop: vi.fn(),
		type: "",
	};
}

function stubBuffer({
	numberOfChannels,
	length,
	sampleRate,
	fill,
}: {
	numberOfChannels: number;
	length: number;
	sampleRate: number;
	fill?: (channel: number, frame: number) => number;
}) {
	const channels = Array.from({ length: numberOfChannels }, (_, channel) =>
		Float32Array.from({ length }, (_, frame) => fill?.(channel, frame) ?? 0)
	);
	return {
		duration: length / sampleRate,
		length,
		numberOfChannels,
		sampleRate,
		getChannelData: (channel: number) => channels[channel],
		copyToChannel: (source: Float32Array, channel: number) => {
			channels[channel].set(source);
		},
	};
}

/**
 * Offline context whose render output is a ramp, so the returned buffer
 * shows exactly which rendered frames were kept.
 */
function stubOfflineContext({ lengths }: { lengths: number[] }) {
	vi.stubGlobal(
		"OfflineAudioContext",
		class {
			destination = audioNode();
			readonly length: number;
			readonly sampleRate: number;
			constructor(_channels: number, length: number, sampleRate: number) {
				this.length = length;
				this.sampleRate = sampleRate;
				lengths.push(length);
			}
			createBuffer = vi.fn(
				(numberOfChannels: number, length: number, sampleRate: number) =>
					stubBuffer({ numberOfChannels, length, sampleRate })
			);
			createBufferSource = vi.fn(() => audioNode());
			createBiquadFilter = vi.fn(() => audioNode());
			createDynamicsCompressor = vi.fn(() => audioNode());
			createStereoPanner = vi.fn(() => audioNode());
			createGain = vi.fn(() => audioNode());
			createConvolver = vi.fn(() => audioNode());
			createDelay = vi.fn(() => audioNode());
			startRendering = vi.fn(async () =>
				stubBuffer({
					numberOfChannels: 2,
					length: this.length,
					sampleRate: this.sampleRate,
					fill: (channel, frame) => channel * 1_000_000 + frame,
				})
			);
		}
	);
}

const element: MediaElement = {
	audio: { ...DEFAULT_MEDIA_AUDIO_SETTINGS } as MediaElement["audio"],
	duration: 2,
	id: "clip",
	mediaId: "sound",
	name: "Sound",
	startTime: 0,
	trimEnd: 0,
	trimStart: 0,
	type: "media",
};

const track: TimelineTrack = {
	elements: [element],
	id: "audio-track",
	name: "Audio",
	type: "audio",
};

const mediaItem = {
	file: new File([new Uint8Array([1, 2, 3, 4])], "sound.wav", {
		type: "audio/wav",
	}),
	id: "sound",
	name: "sound.wav",
	type: "audio",
} as MediaItem;

describe("browser audio export dynamics lookahead", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders past the end by the compressor and limiter lookahead and drops it from the front", async () => {
		const lengths: number[] = [];
		stubOfflineContext({ lengths });

		const rendered = await renderBrowserTimelineAudio({
			tracks: [track],
			mediaItems: [mediaItem],
			totalDuration: 2,
			fps: 30,
		});

		expect(lengths).toEqual([96_000 + LOOKAHEAD_FRAMES]);
		expect(rendered?.length).toBe(96_000);
		expect(rendered?.numberOfChannels).toBe(2);
		for (const channel of [0, 1]) {
			const samples = rendered?.getChannelData(channel);
			expect(samples?.[0]).toBe(channel * 1_000_000 + LOOKAHEAD_FRAMES);
			expect(samples?.[95_999]).toBe(
				channel * 1_000_000 + LOOKAHEAD_FRAMES + 95_999
			);
		}
	});

	it("also trims the track, bus and master strips a project mix adds", async () => {
		const lengths: number[] = [];
		stubOfflineContext({ lengths });
		// Clip strip, track strip, bus strip, master strip: two each.
		const mixLatency = 4 * LOOKAHEAD_FRAMES;

		const rendered = await renderBrowserTimelineAudio({
			tracks: [
				{
					...track,
					audio: normalizeTrackAudioSettings({ audio: { busId: "music" } }),
				},
			],
			mediaItems: [mediaItem],
			totalDuration: 2,
			fps: 30,
			audioMix: {
				master: {
					...createDefaultProjectAudioMixSettings().master,
					gainDb: -3,
				},
				buses: [createDefaultAudioMixBus({ id: "music", name: "Music" })],
			},
		});

		expect(lengths).toEqual([96_000 + mixLatency]);
		expect(rendered?.length).toBe(96_000);
		expect(rendered?.getChannelData(0)[0]).toBe(mixLatency);
	});
});
