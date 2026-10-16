import { describe, expect, it } from "vitest";
import {
	audioMixConfigFromTimeline,
	embeddedAudioMixInput,
} from "../claude/handlers/claude-export-handler/export-audio-mix.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import type { ClaudeTimeline, ClaudeTrack } from "../types/claude-api.js";

/** The project mix a native export reads from the editor's timeline snapshot. */

function track(fields: Partial<ClaudeTrack> & { id: string }): ClaudeTrack {
	return { index: 0, name: fields.id, type: "audio", elements: [], ...fields };
}

function timeline(
	tracks: ClaudeTrack[],
	audioMix?: ClaudeTimeline["audioMix"]
): ClaudeTimeline {
	return {
		name: "Doors",
		duration: 4,
		width: 1920,
		height: 1080,
		fps: 30,
		tracks,
		...(audioMix ? { audioMix } : {}),
	};
}

const audio = (fields: Record<string, unknown>) =>
	({
		gainDb: 0,
		pan: 0,
		solo: false,
		busId: "master",
		...fields,
	}) as ClaudeTrack["audio"];

describe("native export mix", () => {
	it("is absent when the snapshot changes nothing, older snapshots included", () => {
		expect(
			audioMixConfigFromTimeline(timeline([track({ id: "a" })]))
		).toBeUndefined();
		expect(
			audioMixConfigFromTimeline(
				timeline([track({ id: "a", audio: audio({}) })])
			)
		).toBeUndefined();
	});

	it("carries each audio track's settings, mute and the project's buses", () => {
		const config = audioMixConfigFromTimeline(
			timeline(
				[
					track({ id: "main", type: "media", audio: audio({ gainDb: -10 }) }),
					track({ id: "guns", audio: audio({ busId: "sfx" }), muted: true }),
					track({ id: "titles", type: "text" }),
				],
				{
					master: {
						id: "master",
						name: "Master",
						gainDb: -2,
						pan: 0,
						muted: false,
						solo: false,
						effects: undefined as never,
					},
					buses: [
						{
							id: "sfx",
							name: "SFX",
							gainDb: -4,
							pan: 0,
							muted: false,
							solo: false,
							effects: undefined as never,
						},
					],
				}
			)
		);
		expect(config?.tracks.map((entry) => entry.trackId)).toEqual([
			"main",
			"guns",
		]);
		expect(config?.tracks[0]).toMatchObject({ gainDb: -10, muted: false });
		expect(config?.tracks[1]).toMatchObject({ busId: "sfx", muted: true });
		expect(config?.master.gainDb).toBe(-2);
		expect(config?.buses[0]).toMatchObject({ id: "sfx", gainDb: -4 });
		// Effects the snapshot leaves out fall back to off.
		expect(config?.master.effects.limiter.enabled).toBe(false);
	});

	it("puts the base video's own audio on the track its picture comes from", () => {
		expect(
			embeddedAudioMixInput({
				path: "/tmp/base.mp4",
				segments: [{ trackId: "main" } as ExportSegment],
			})
		).toEqual({
			path: "/tmp/base.mp4",
			trackId: "main",
			startTime: 0,
			volume: 1,
		});
		expect(
			embeddedAudioMixInput({ path: "/tmp/base.mp4", segments: [] })
		).toBeNull();
	});
});
