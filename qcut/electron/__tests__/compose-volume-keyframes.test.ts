// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getFFmpegPath } from "../ffmpeg/paths.js";
import { buildComposeNormalizeArgs } from "../native-pipeline/compose/compose-ffmpeg.js";
import { compileComposeManifestToPatch } from "../native-pipeline/compose/compose-manifest-to-patch.js";
import { parseComposeManifest } from "../native-pipeline/compose/compose-manifest.js";
import {
	COMPOSE_PROTOCOL_VERSION,
	type ComposePatch,
	type ComposeSnapshot,
	computeComposeSourceFingerprint,
	validateComposePatch,
} from "../native-pipeline/compose/compose-protocol.js";
import { timelineManifestFromComposePatch } from "../native-pipeline/compose/compose-timeline-manifest.js";
import {
	editorVolumeAudio,
	volumeEnvelopeFilters,
} from "../native-pipeline/compose/compose-volume-keyframes.js";

const execFileAsync = promisify(execFile);
const ffmpegPath = getFFmpegPath();
const SAMPLE_RATE = 48_000;
const CREATED_AT = "2026-10-14T00:00:00.000Z";

/** Music at full level, ducked 20 dB under a voice from 1 s to 2 s. */
const DUCK = [
	{ time: 0, volumeDb: 0 },
	{ time: 1, volumeDb: 0 },
	{ time: 1.25, volumeDb: -20 },
	{ time: 2, volumeDb: -20 },
	{ time: 2.25, volumeDb: 0 },
];

function snapshot({ fps }: { fps: number }): ComposeSnapshot {
	const project = {
		id: "project-1",
		fps,
		canvasSize: { width: 1920, height: 1080 },
		duration: 0,
	};
	return {
		schemaVersion: COMPOSE_PROTOCOL_VERSION,
		id: "snapshot-1",
		createdAt: CREATED_AT,
		sourceFingerprint: computeComposeSourceFingerprint({
			project,
			media: [],
			captions: [],
		}),
		project,
		media: [],
		captions: [],
		beats: [],
		shots: [],
		availableResources: [],
		capabilities: { headlessRender: true, editorApply: true },
	};
}

function patchWith({
	operations,
}: {
	operations: ComposePatch["operations"];
}): ComposePatch {
	return {
		schemaVersion: COMPOSE_PROTOCOL_VERSION,
		id: "patch-1",
		source: "local-heuristic",
		intentKind: "smart-packaging",
		mode: "idempotent",
		snapshotId: "snapshot-1",
		sourceFingerprint: snapshot({ fps: 30 }).sourceFingerprint,
		createdAt: CREATED_AT,
		operations,
		warnings: [],
	};
}

function manifestWith({ audio }: { audio: Record<string, unknown> }) {
	return parseComposeManifest({
		value: {
			schemaVersion: 1,
			canvas: { width: 1920, height: 1080, fps: 30 },
			clips: [
				{
					id: "a",
					source: "a.mp4",
					volumeKeyframes: [
						{ time: 2, volumeDb: -6 },
						{ time: 0, volumeDb: 0 },
					],
				},
			],
			audio: [audio],
		},
	});
}

/** Level in dB of each window relative to the first window. */
async function measuredLevels({
	filters,
	windows,
}: {
	filters: string[];
	windows: Array<[number, number]>;
}): Promise<number[]> {
	const { stdout } = await execFileAsync(
		ffmpegPath,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=1000:sample_rate=${SAMPLE_RATE}:duration=3`,
			"-af",
			filters.join(","),
			"-ac",
			"1",
			"-f",
			"f32le",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
	);
	const samples = new Float32Array(
		stdout.buffer,
		stdout.byteOffset,
		stdout.byteLength / 4
	);
	const rms = windows.map(([from, to]) => {
		const window = samples.subarray(
			Math.round(from * SAMPLE_RATE),
			Math.round(to * SAMPLE_RATE)
		);
		let sum = 0;
		for (const sample of window) sum += sample * sample;
		return Math.sqrt(sum / window.length);
	});
	return rms.map((value) => 20 * Math.log10(value / rms[0]));
}

describe("compose volume keyframes", () => {
	it("builds a dB envelope that holds the end values", () => {
		expect(volumeEnvelopeFilters({ keyframes: [] })).toEqual([]);
		expect(
			volumeEnvelopeFilters({
				keyframes: [
					{ time: 2, volumeDb: -12 },
					{ time: 0.5, volumeDb: 0 },
				],
			})
		).toEqual([
			"asetnsamples=n=256:p=0",
			"volume='pow(10,(if(lt(t,0.5),0,if(lt(t,2),0+(-12)*(t-0.5)/1.5,-12)))/20)':eval=frame",
		]);
	});

	it("converts seconds to editor frames at the project rate", () => {
		expect(editorVolumeAudio({ keyframes: [], fps: 25 })).toBeUndefined();
		expect(
			editorVolumeAudio({
				keyframes: [
					{ time: 1.2, volumeDb: -12 },
					{ time: 0, volumeDb: 0 },
					// Lands on frame 30 too; the later keyframe wins.
					{ time: 1.21, volumeDb: -18 },
				],
				fps: 25,
			})
		).toEqual({
			keyframes: {
				volumeDb: [
					{ id: "volumeDb-0", frame: 0, value: 0, easing: "linear" },
					{ id: "volumeDb-30", frame: 30, value: -18, easing: "linear" },
				],
			},
		});
	});

	it("applies the envelope after the clip's timestamps are rebased", () => {
		const args = buildComposeNormalizeArgs({
			input: "in.mp4",
			output: "out.mp4",
			trimIn: 1,
			duration: 3,
			width: 1920,
			height: 1080,
			fps: 30,
			hasAudio: true,
			volumeKeyframes: DUCK,
		});
		const audioChain = args[args.indexOf("-filter_complex") + 1]
			.split(";")
			.find((chain) => chain.endsWith("[aout]"));
		expect(audioChain).toMatch(
			/asetpts=PTS-STARTPTS,.*aformat=[^,]+,asetnsamples=n=256:p=0,volume='pow\(10,.*\)':eval=frame,apad=/
		);
	});

	it("validates manifest keyframes and sorts them by time", () => {
		const manifest = manifestWith({
			audio: {
				type: "sound-effect",
				source: "song.mp3",
				start: 0,
				volumeKeyframes: DUCK,
			},
		});
		expect(manifest.clips[0].volumeKeyframes).toEqual([
			{ time: 0, volumeDb: 0 },
			{ time: 2, volumeDb: -6 },
		]);
		expect(manifest.audio[0].volumeKeyframes).toEqual(DUCK);

		expect(() =>
			manifestWith({
				audio: {
					type: "sound-effect",
					source: "song.mp3",
					start: 0,
					volume: 0.5,
					volumeKeyframes: DUCK,
				},
			})
		).toThrow("drop volume or fold it into the keyframes");
		expect(() =>
			manifestWith({
				audio: {
					type: "sound-effect",
					source: "song.mp3",
					start: 0,
					volumeKeyframes: [{ time: 0, volumeDb: 20 }],
				},
			})
		).toThrow();
	});

	it("carries keyframes from the manifest onto patch operations", () => {
		const { patch } = compileComposeManifestToPatch({
			manifest: manifestWith({
				audio: {
					type: "sound-effect",
					source: "song.mp3",
					start: 0,
					volumeKeyframes: DUCK,
				},
			}),
			manifestSha256: "a".repeat(64),
			projectId: "project-1",
			snapshot: snapshot({ fps: 30 }),
			sources: {
				"a.mp4": { durationSeconds: 5, mediaKind: "video" },
				"song.mp3": { durationSeconds: 5, mediaKind: "audio" },
			},
			createdAt: CREATED_AT,
		});
		expect(
			patch.operations.find(({ kind }) => kind === "insert-media-clip")
		).toMatchObject({
			volumeKeyframes: [
				{ time: 0, volumeDb: 0 },
				{ time: 2, volumeDb: -6 },
			],
		});
		expect(
			patch.operations.find(({ kind }) => kind === "add-sound-effect")
		).toMatchObject({ volume: 1, volumeKeyframes: DUCK });
	});

	it("reports malformed patch keyframes as validation issues", () => {
		const issues = validateComposePatch({
			snapshot: snapshot({ fps: 30 }),
			patch: patchWith({
				operations: [
					{
						kind: "add-sound-effect",
						id: "sound:1",
						startTime: 0,
						duration: 2,
						volume: 1,
						asset: {
							provider: "local",
							assetType: "sound",
							assetId: "fx",
						},
						volumeKeyframes: [{ time: -1, volumeDb: 0 }],
					},
				],
			}),
		});
		expect(issues).toContainEqual(
			expect.objectContaining({
				severity: "error",
				path: "operations.0.volumeKeyframes.0",
				operationId: "sound:1",
			})
		);
	});

	it("plans keyframes as editor audio settings on sounds and clips", () => {
		const plan = timelineManifestFromComposePatch({
			projectId: "project-1",
			snapshot: snapshot({ fps: 25 }),
			patch: patchWith({
				operations: [
					{
						kind: "insert-media-clip",
						id: "clip:a",
						startTime: 0,
						duration: 5,
						asset: {
							provider: "local",
							assetType: "media",
							assetId: "manifest:a.mp4",
							localPath: "/abs/a.mp4",
						},
						mediaKind: "video",
						trackRole: "main-video",
						trimStart: 0,
						trimEnd: 0,
						sourceDuration: 5,
						volumeKeyframes: [{ time: 2, volumeDb: -6 }],
					},
					{
						kind: "add-sound-effect",
						id: "sound:music",
						startTime: 1,
						duration: 3,
						volume: 1,
						asset: {
							provider: "local",
							assetType: "sound",
							assetId: "song",
							localPath: "/abs/song.mp3",
						},
						volumeKeyframes: DUCK,
					},
				],
			}),
		});
		const elements = (
			plan.manifest.tracks as Array<{
				elements: Array<Record<string, unknown>>;
			}>
		).flatMap((track) => track.elements);
		expect(elements.find(({ id }) => id === "clip:a")?.audio).toEqual({
			keyframes: {
				volumeDb: [
					{ id: "volumeDb-50", frame: 50, value: -6, easing: "linear" },
				],
			},
		});
		expect(elements.find(({ id }) => id === "sound:music")?.audio).toEqual(
			editorVolumeAudio({ keyframes: DUCK, fps: 25 })
		);
	});
});

describe.skipIf(!existsSync(ffmpegPath))(
	"compose volume envelope in FFmpeg",
	() => {
		it("ducks and restores the level the keyframes describe", async () => {
			const [, ducked, ramp, restored] = await measuredLevels({
				filters: volumeEnvelopeFilters({ keyframes: DUCK }),
				windows: [
					[0.2, 0.8],
					[1.4, 1.9],
					// Halfway down the 1 s → 1.25 s ramp.
					[1.12, 1.13],
					[2.4, 2.9],
				],
			});
			expect(ducked).toBeCloseTo(-20, 0);
			expect(ramp).toBeCloseTo(-10, 0);
			expect(restored).toBeCloseTo(0, 1);
		});
	}
);
