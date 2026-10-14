import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement } from "@/types/timeline";
import { parseClaudeMediaAudioChanges } from "../claude-media-audio-changes";
import { applyElementChanges } from "../claude-timeline-bridge-elements";

const storeMocks = vi.hoisted(() => {
	const state = {
		tracks: [
			{
				id: "track",
				name: "Music",
				type: "audio",
				elements: [
					{
						id: "music",
						type: "media" as const,
						mediaId: "song",
						name: "Song",
						startTime: 0,
						duration: 10,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
		pushHistory: vi.fn(),
		updateElementStartTime: vi.fn(),
		updateElementTrim: vi.fn(),
		updateElementDuration: vi.fn(),
		updateMediaElement: vi.fn(),
		updateMediaTiming: vi.fn(),
	};
	return { state };
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => storeMocks.state) },
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

const music = storeMocks.state.tracks[0].elements[0] as MediaElement;

describe("parseClaudeMediaAudioChanges", () => {
	it("ducks music with sorted, clamped volume keyframes", () => {
		const audio = parseClaudeMediaAudioChanges({
			element: music,
			value: {
				keyframes: {
					volumeDb: [
						{ frame: 75, value: 0 },
						{ frame: 30, value: 0 },
						{ frame: 36, value: -12, easing: "easeOut" },
						{ frame: 69, value: -80 },
					],
				},
			},
		});

		expect(audio.keyframes?.volumeDb).toEqual([
			{ id: "volumeDb-30", frame: 30, value: 0, easing: "linear" },
			{ id: "volumeDb-36", frame: 36, value: -12, easing: "easeOut" },
			// Clamped to the property's -60 dB floor.
			{ id: "volumeDb-69", frame: 69, value: -60, easing: "linear" },
			{ id: "volumeDb-75", frame: 75, value: 0, easing: "linear" },
		]);
	});

	it("merges settings groups and keeps keyframes it was not given", () => {
		const element = {
			...music,
			audio: parseClaudeMediaAudioChanges({
				element: music,
				value: { keyframes: { pan: [{ frame: 0, value: -50 }] } },
			}),
		} as MediaElement;

		const audio = parseClaudeMediaAudioChanges({
			element,
			value: {
				volumeDb: -6,
				compressor: { enabled: true },
				keyframes: { volumeDb: [{ frame: 0, value: -3 }] },
			},
		});

		expect(audio.volumeDb).toBe(-6);
		expect(audio.compressor.enabled).toBe(true);
		expect(audio.compressor.ratio).toBe(element.audio?.compressor.ratio);
		expect(audio.keyframes?.pan).toHaveLength(1);
		expect(audio.keyframes?.volumeDb).toHaveLength(1);
	});

	it("removes a property's keyframes for an empty list or null", () => {
		const element = {
			...music,
			audio: parseClaudeMediaAudioChanges({
				element: music,
				value: { keyframes: { volumeDb: [{ frame: 0, value: -3 }] } },
			}),
		} as MediaElement;

		for (const removal of [[], null]) {
			const audio = parseClaudeMediaAudioChanges({
				element,
				value: { keyframes: { volumeDb: removal } },
			});
			expect(audio.keyframes?.volumeDb).toBeUndefined();
		}
	});

	it("deep-merges nested groups and keeps the fields it was not given", () => {
		const element = {
			...music,
			audio: parseClaudeMediaAudioChanges({
				element: music,
				value: { repair: { deHum: { frequencyHz: 60 } } },
			}),
		} as MediaElement;

		const audio = parseClaudeMediaAudioChanges({
			element,
			value: { repair: { deHum: { enabled: true } } },
		});

		expect(audio.repair.deHum).toEqual({
			enabled: true,
			frequencyHz: 60,
			harmonics: 4,
		});
		expect(audio.repair.deEsser).toEqual(element.audio?.repair.deEsser);
	});

	it.each([
		["a non-object", "loud", "audio must be an object"],
		[
			"a boolean sent as a string",
			{ enabled: "false" },
			"audio.enabled must be true or false",
		],
		[
			"a number sent as a string",
			{ compressor: { ratio: "4" } },
			"audio.compressor.ratio must be a number",
		],
		[
			"a misspelled setting",
			{ compresor: { enabled: true } },
			'Unknown audio setting "audio.compresor"',
		],
		[
			"a setting the processing pipeline owns",
			{ separation: { stemMediaIds: { vocals: "media-1" } } },
			'Unknown audio setting "audio.separation.stemMediaIds"',
		],
		[
			"an inherited keyframe property name",
			{ keyframes: { toString: [{ frame: 0, value: 1 }] } },
			'Unknown audio keyframe property "toString"',
		],
		[
			"a __proto__ keyframe property from JSON",
			JSON.parse('{"keyframes":{"__proto__":[{"frame":0,"value":1}]}}'),
			'Unknown audio keyframe property "__proto__"',
		],
		[
			"an unknown property",
			{ keyframes: { loudness: [] } },
			'Unknown audio keyframe property "loudness"',
		],
		[
			"a fractional frame",
			{ keyframes: { volumeDb: [{ frame: 1.5, value: 0 }] } },
			"audio.keyframes.volumeDb[0].frame must be a whole number of frames >= 0",
		],
		[
			"a missing value",
			{ keyframes: { volumeDb: [{ frame: 0 }] } },
			"audio.keyframes.volumeDb[0].value must be a number",
		],
		[
			"an unknown easing",
			{ keyframes: { volumeDb: [{ frame: 0, value: 0, easing: "bounce" }] } },
			"audio.keyframes.volumeDb[0].easing must be one of",
		],
	])("rejects %s", (_label, value, message) => {
		expect(() =>
			parseClaudeMediaAudioChanges({ element: music, value })
		).toThrow(message);
	});
});

describe("applyElementChanges with audio", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies validated audio settings to a media element", () => {
		const result = applyElementChanges({
			elementId: "music",
			changes: {
				audio: { keyframes: { volumeDb: [{ frame: 30, value: -12 }] } },
			},
			pushHistory: false,
		});

		expect(result).toEqual({ applied: true });
		expect(storeMocks.state.updateMediaElement).toHaveBeenCalledWith(
			"track",
			"music",
			{
				audio: expect.objectContaining({
					keyframes: {
						volumeDb: [
							{ id: "volumeDb-30", frame: 30, value: -12, easing: "linear" },
						],
					},
				}),
			},
			false
		);
	});

	it("rejects malformed audio before touching timing", () => {
		const result = applyElementChanges({
			elementId: "music",
			changes: {
				startTime: 2,
				audio: { keyframes: { volumeDb: "duck" } },
			},
			pushHistory: false,
		});

		expect(result).toEqual({
			applied: false,
			error: "audio.keyframes.volumeDb must be an array",
		});
		expect(storeMocks.state.updateElementStartTime).not.toHaveBeenCalled();
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});
});
