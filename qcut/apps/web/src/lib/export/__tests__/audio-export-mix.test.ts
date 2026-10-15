import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exportAudioCLI: vi.fn(),
	getFileInfo: vi.fn(),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		files: { getFileInfo: mocks.getFileInfo },
		ffmpeg: { exportAudioCLI: mocks.exportAudioCLI },
		isElectron: true,
	}),
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({ activeProject: { id: "project-1" } }),
	},
}));

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: { loadMediaItem: vi.fn() },
}));

import {
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import { exportTimelineAudio } from "../audio-export";

/** The standalone MP3 carries the project mix, like the video export does. */
describe("standalone audio export mix", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.exportAudioCLI.mockResolvedValue({
			fileSize: 512,
			outputPath: "/tmp/mix.mp3",
		});
		mocks.getFileInfo.mockResolvedValue({ size: 1 });
	});

	it("sends the tracks' settings, the buses and the master to FFmpeg", async () => {
		await exportTimelineAudio({
			bitrate: 192,
			duration: 5,
			outputPath: "/tmp/mix.mp3",
			sampleRate: 48_000,
			mediaItems: [
				{
					file: new File([], "guns.wav", { type: "audio/wav" }),
					id: "guns-audio",
					localPath: "/tmp/guns.wav",
					name: "guns.wav",
					type: "audio",
				},
			],
			tracks: [
				{
					id: "guns",
					name: "SFX · Guns",
					type: "audio",
					audio: normalizeTrackAudioSettings({
						audio: { gainDb: -6, busId: "sfx" },
					}),
					elements: [
						{
							duration: 5,
							id: "shot",
							mediaId: "guns-audio",
							name: "Shot",
							startTime: 0,
							trimEnd: 0,
							trimStart: 0,
							type: "media",
						},
					],
				},
			],
			audioMix: {
				...createDefaultProjectAudioMixSettings(),
				buses: [createDefaultAudioMixBus({ id: "sfx", name: "SFX" })],
			},
		});

		const options = mocks.exportAudioCLI.mock.calls[0]?.[0];
		expect(options.audioMixConfig).toMatchObject({
			master: { id: "master" },
			buses: [{ id: "sfx" }],
			tracks: [{ trackId: "guns", gainDb: -6, busId: "sfx", muted: false }],
		});
		expect(options.audioCrossfades).toEqual([]);
		expect(options.audioFiles[0]).toMatchObject({ trackId: "guns" });
	});
});
