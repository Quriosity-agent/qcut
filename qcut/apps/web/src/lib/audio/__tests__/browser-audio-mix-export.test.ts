import { describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import {
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "../audio-mix-settings";
import {
	buildExportAudioMix,
	duckingSourceTrackIds,
	exportAudioMixStages,
	measureDuckingLevels,
	resolveExportAudioMix,
} from "../browser-audio-mix-export";

/** The export mix's wiring and ducking schedule, on a fake audio graph. */

interface FakeNode {
	kind: string;
	connections: FakeNode[];
	[parameter: string]: unknown;
}

function param() {
	return { value: 0, setTargetAtTime: vi.fn() };
}

function fakeContext() {
	const nodes: FakeNode[] = [];
	const node = (kind: string): FakeNode => {
		const created: FakeNode = {
			kind,
			connections: [],
			type: "",
			gain: param(),
			frequency: param(),
			Q: param(),
			threshold: param(),
			ratio: param(),
			knee: param(),
			attack: param(),
			release: param(),
			pan: param(),
			delayTime: param(),
		};
		created.connect = (target: FakeNode) => {
			created.connections.push(target);
		};
		nodes.push(created);
		return created;
	};
	const context = {
		destination: node("destination"),
		createGain: () => node("gain"),
		createBiquadFilter: () => node("biquad"),
		createDynamicsCompressor: () => node("dynamics"),
		createStereoPanner: () => node("panner"),
		createDelay: () => node("delay"),
	};
	return { context: context as unknown as BaseAudioContext, nodes };
}

/** Follows connections from `start` and lists the kinds of node passed. */
function pathKinds(start: FakeNode): string[] {
	const kinds: string[] = [];
	let current: FakeNode | undefined = start;
	while (current) {
		kinds.push(current.kind);
		current = current.connections[0];
	}
	return kinds;
}

function track(
	id: string,
	audio: Parameters<typeof normalizeTrackAudioSettings>[0]["audio"] = {}
): TimelineTrack {
	return {
		id,
		name: id,
		type: "audio",
		elements: [],
		audio: normalizeTrackAudioSettings({ audio }),
	};
}

const ducking = (sourceTrackIds: string[]) => ({
	...normalizeTrackAudioSettings({}).ducking,
	enabled: true,
	sourceTrackIds,
	thresholdDb: -30,
	reductionDb: -12,
	attackMs: 20,
	releaseMs: 200,
});

const withBus = {
	...createDefaultProjectAudioMixSettings(),
	buses: [createDefaultAudioMixBus({ id: "sfx", name: "SFX" })],
};

describe("export audio mix", () => {
	it("is skipped without a project mix or when it changes nothing", () => {
		expect(resolveExportAudioMix({ tracks: [track("a")] })).toBeNull();
		expect(
			resolveExportAudioMix({
				tracks: [track("a")],
				audioMix: createDefaultProjectAudioMixSettings(),
			})
		).toBeNull();
		expect(
			resolveExportAudioMix({
				tracks: [track("a", { gainDb: -6 })],
				audioMix: createDefaultProjectAudioMixSettings(),
			})
		).not.toBeNull();
	});

	it("counts a bus strip only when a heard track uses one", () => {
		const direct = resolveExportAudioMix({
			tracks: [track("a", { gainDb: -1 })],
			audioMix: withBus,
		});
		const routed = resolveExportAudioMix({
			tracks: [track("a", { busId: "sfx" })],
			audioMix: withBus,
		});
		expect(direct && exportAudioMixStages(direct)).toBe(4);
		expect(routed && exportAudioMixStages(routed)).toBe(6);
	});

	it("routes tracks through their bus, delays direct ones to match, and leaves silenced ones out", () => {
		const mix = resolveExportAudioMix({
			tracks: [
				track("guns", { busId: "sfx" }),
				track("voice"),
				track("score", { busId: "sfx" }),
				{ ...track("muted"), muted: true },
			],
			audioMix: withBus,
		});
		if (!mix) throw new Error("expected a mix");
		const { context } = fakeContext();
		const inputs = buildExportAudioMix({
			context,
			mix,
			duckingSources: new Map(),
			lookaheadSeconds: 0.006,
			clipStages: 2,
		});

		expect([...inputs.keys()]).toEqual(["guns", "voice", "score"]);
		const strip = [
			"gain",
			...Array(10).fill("biquad"),
			"dynamics",
			"gain",
			"gain",
			"gain",
			"panner",
			"dynamics",
		];
		const toDestination = [...strip, "destination"];
		expect(pathKinds(inputs.get("guns") as unknown as FakeNode)).toEqual([
			...strip,
			...strip,
			...toDestination,
		]);
		const voicePath = pathKinds(inputs.get("voice") as unknown as FakeNode);
		expect(voicePath).toEqual([...strip, "delay", ...toDestination]);
	});

	it("measures the editor meter's level: RMS of the mono mix over 2048 samples", () => {
		const sampleRate = 48_000;
		const length = sampleRate;
		const left = new Float32Array(length);
		const right = new Float32Array(length);
		// Silence, then 0.5 on the left only from 0.5 s: mono 0.25, -12.04 dB.
		left.fill(0.5, sampleRate / 2);
		const buffer = {
			sampleRate,
			length,
			numberOfChannels: 2,
			getChannelData: (channel: number) => (channel === 0 ? left : right),
		} as unknown as AudioBuffer;

		const { levelsDb, checkSeconds } = measureDuckingLevels({ buffer });
		expect(checkSeconds).toBeCloseTo(1 / 60, 6);
		expect(levelsDb[0]).toBe(-120);
		expect(levelsDb[29]).toBe(-120);
		expect(levelsDb[59]).toBeCloseTo(-12.04, 2);
	});

	it("skips the trimmed latency when measuring", () => {
		const left = Float32Array.from({ length: 4_000 }, (_, frame) =>
			frame < 1_000 ? 1 : 0
		);
		const buffer = {
			sampleRate: 48_000,
			length: 4_000,
			numberOfChannels: 1,
			getChannelData: () => left,
		} as unknown as AudioBuffer;
		expect(
			[...measureDuckingLevels({ buffer, startFrame: 1_000 }).levelsDb].every(
				(level) => level === -120
			)
		).toBe(true);
	});

	it("ducks only under heard sources other than the track itself", () => {
		const mix = resolveExportAudioMix({
			tracks: [
				track("music", { ducking: ducking(["music", "voice", "sfx"]) }),
				track("voice"),
				{ ...track("sfx"), muted: true },
			],
			audioMix: createDefaultProjectAudioMixSettings(),
		});
		expect(mix && duckingSourceTrackIds(mix)).toEqual(["voice"]);
	});

	it("glides the target down while a source is loud and back up after", () => {
		const mix = resolveExportAudioMix({
			tracks: [track("music", { ducking: ducking(["voice"]) }), track("voice")],
			audioMix: createDefaultProjectAudioMixSettings(),
		});
		if (!mix) throw new Error("expected a mix");
		const { context, nodes } = fakeContext();
		// Loud (-20 dB) from check 3 to check 5.
		const levelsDb = Float32Array.from({ length: 10 }, (_, check) =>
			check >= 3 && check < 6 ? -20 : -120
		);
		buildExportAudioMix({
			context,
			mix,
			duckingSources: new Map([["voice", { levelsDb, checkSeconds: 0.1 }]]),
			lookaheadSeconds: 0.006,
			clipStages: 2,
		});

		const scheduled = nodes
			.filter((node) => node.kind === "gain")
			.map((node) => (node.gain as ReturnType<typeof param>).setTargetAtTime)
			.filter((setTarget) => setTarget.mock.calls.length > 0);
		expect(scheduled).toHaveLength(1);
		const calls = scheduled[0].mock.calls;
		// The duck stage runs three lookaheads (two clip stages and the
		// track's compressor) behind the timeline.
		expect(calls).toHaveLength(2);
		expect(calls[0][0]).toBeCloseTo(10 ** (-12 / 20), 6);
		expect(calls[0][1]).toBeCloseTo(0.3 + 0.018, 6);
		expect(calls[0][2]).toBeCloseTo(0.02, 6);
		expect(calls[1][0]).toBe(1);
		expect(calls[1][1]).toBeCloseTo(0.6 + 0.018, 6);
		expect(calls[1][2]).toBeCloseTo(0.2, 6);
	});
});
