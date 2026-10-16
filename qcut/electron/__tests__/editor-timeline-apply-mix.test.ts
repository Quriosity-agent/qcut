import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineApplyManifest } from "../native-pipeline/editor/editor-timeline-apply.js";

/**
 * `timeline apply` against a small stand-in editor that keeps state the way
 * the real routes do: tracks with their switches, elements, and the mix
 * (buses, master, each audio track's settings). Covers what a `timeline
 * export` carries beyond clips: track colour/mute/hidden/lock, the mix, and
 * applying a manifest in parts without shuffling the tracks already there.
 */

type Record_ = Record<string, unknown>;

interface FakeTrack extends Record_ {
	id: string;
	name: string;
	type: string;
	isMain?: boolean;
	elements: Array<Record_ & { id: string }>;
	audio?: Record_;
}

interface FakeBus extends Record_ {
	id: string;
	name: string;
}

const DEFAULT_AUDIO = {
	gainDb: 0,
	pan: 0,
	solo: false,
	busId: "master",
	effects: {},
	ducking: { enabled: false, sourceTrackIds: [] },
	autoCrossfade: { enabled: false, defaultDuration: 0.5, curve: "equal-power" },
};

function makeOptions(manifest: object, extra: Partial<CLIRunOptions> = {}) {
	return {
		command: "editor:timeline:apply",
		projectId: "project-1",
		manifest: JSON.stringify(manifest),
		atomic: true,
		verify: true,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...extra,
	} as CLIRunOptions;
}

function makeEditor({
	tracks = [
		{ id: "main", name: "Main", type: "media", isMain: true, elements: [] },
	],
	buses = [],
	masterIgnoresGain = false,
}: {
	tracks?: FakeTrack[];
	buses?: FakeBus[];
	/** The stand-in editor drops master level changes, to force a mismatch. */
	masterIgnoresGain?: boolean;
} = {}) {
	const state = {
		tracks: tracks.map((track) => ({
			...track,
			elements: [...track.elements],
		})),
		master: { id: "master", name: "Master", gainDb: 0, pan: 0 } as Record_,
		buses: buses.map((bus) => ({ ...bus })),
		next: 1,
	};
	const carriesAudio = (track: FakeTrack) =>
		track.type === "audio" || track.type === "media";
	const timeline = () => ({
		tracks: state.tracks.map((track, index) => ({
			...track,
			index,
			elements: track.elements.map((element) => {
				const trimStart = Number(element.trimStart ?? 0);
				const trimEnd = Number(element.trimEnd ?? 0);
				const duration = Number(element.duration) - trimStart - trimEnd;
				return {
					...element,
					duration,
					timelineDuration: duration,
					endTime: Number(element.startTime) + duration,
				};
			}),
			transitions: [],
		})),
	});
	// Fresh copies, as JSON over HTTP would be: a snapshot kept by the apply
	// must not change when the stand-in editor does.
	const mix = () => ({
		projectId: "project-1",
		master: structuredClone(state.master),
		buses: structuredClone(state.buses),
		tracks: state.tracks.filter(carriesAudio).map((track) => ({
			trackId: track.id,
			name: track.name,
			type: track.type,
			muted: track.muted === true,
			audio: { ...DEFAULT_AUDIO, ...track.audio },
			effective: { silenced: false, busId: "master" },
		})),
	});
	const findTrack = (id: string) => {
		const track = state.tracks.find((candidate) => candidate.id === id);
		if (!track) throw new Error(`fake: no track ${id}`);
		return track;
	};
	const get = vi.fn(async (url: string) => {
		if (url === "/api/claude/navigator/projects") {
			return { activeProjectId: "project-1" };
		}
		if (url === "/api/claude/media/project-1") return [];
		if (url === "/api/claude/timeline/project-1") return timeline();
		if (url === "/api/claude/mix/project-1") return mix();
		throw new Error(`fake: unexpected GET ${url}`);
	});
	const post = vi.fn(async (url: string, body: Record_) => {
		if (url === "/api/claude/navigator/open") return { navigated: true };
		if (url === "/api/claude/transaction/begin") {
			return { transactionId: "transaction-1" };
		}
		if (url.endsWith("/commit") || url.endsWith("/rollback")) return {};
		if (url === "/api/claude/timeline/project-1/tracks") {
			const { index, ...rest } = body;
			const track: FakeTrack = {
				...rest,
				id: `track-${state.next++}`,
				name: String(body.name ?? "Track"),
				type: String(body.type),
				elements: [],
			};
			if (typeof index === "number") state.tracks.splice(index, 0, track);
			else state.tracks.push(track);
			return { trackId: track.id };
		}
		if (url === "/api/claude/timeline/project-1/elements/batch") {
			const elements = body.elements as Record_[];
			return {
				added: elements.map((element, index) => {
					const id = `el-${state.next++}`;
					findTrack(String(element.trackId)).elements.push({
						...element,
						id,
					});
					return { index, success: true, elementId: id };
				}),
				failedCount: 0,
			};
		}
		if (url === "/api/claude/mix/project-1/buses") {
			const { id, ...rest } = body;
			const bus: FakeBus = {
				gainDb: 0,
				pan: 0,
				muted: false,
				solo: false,
				...rest,
				id: typeof id === "string" ? id : `bus-${state.next++}`,
				name: String(body.name),
			};
			state.buses.push(bus);
			return { busId: bus.id };
		}
		throw new Error(`fake: unexpected POST ${url}`);
	});
	const patch = vi.fn(async (url: string, body: Record_) => {
		const track = url.match(
			/^\/api\/claude\/timeline\/project-1\/tracks\/([^/]+)$/
		);
		if (track) {
			const target = findTrack(decodeURIComponent(track[1]));
			const { index, ...rest } = body;
			Object.assign(target, rest);
			if (typeof index === "number") {
				state.tracks.splice(state.tracks.indexOf(target), 1);
				state.tracks.splice(index, 0, target);
			}
			return { success: true };
		}
		if (url === "/api/claude/timeline/project-1/elements/batch") {
			const updates = body.updates as Array<Record_ & { elementId: string }>;
			for (const { elementId, ...changes } of updates) {
				for (const candidate of state.tracks) {
					const element = candidate.elements.find((e) => e.id === elementId);
					if (element) Object.assign(element, changes);
				}
			}
			return {
				results: updates.map((_, index) => ({ index, success: true })),
				updatedCount: updates.length,
				failedCount: 0,
			};
		}
		const mixTrack = url.match(
			/^\/api\/claude\/mix\/project-1\/tracks\/([^/]+)$/
		);
		if (mixTrack) {
			const target = findTrack(decodeURIComponent(mixTrack[1]));
			target.audio = { ...DEFAULT_AUDIO, ...target.audio, ...body };
			return { mix: mix() };
		}
		const bus = url.match(/^\/api\/claude\/mix\/project-1\/buses\/([^/]+)$/);
		if (bus) {
			const id = decodeURIComponent(bus[1]);
			if (id === "master") {
				const { gainDb, ...rest } = body;
				Object.assign(state.master, masterIgnoresGain ? rest : body);
				return { bus: state.master, mix: mix() };
			}
			const target = state.buses.find((candidate) => candidate.id === id);
			if (!target) throw new Error(`fake: no bus ${id}`);
			Object.assign(target, body);
			return { bus: target, mix: mix() };
		}
		throw new Error(`fake: unexpected PATCH ${url}`);
	});
	const del = vi.fn(async (url: string) => {
		const bus = url.match(/^\/api\/claude\/mix\/project-1\/buses\/([^/]+)$/);
		if (bus) {
			state.buses = state.buses.filter(
				(candidate) => candidate.id !== decodeURIComponent(bus[1])
			);
			return { removed: bus[1] };
		}
		const track = url.match(
			/^\/api\/claude\/timeline\/project-1\/tracks\/([^/]+)$/
		);
		if (track) {
			state.tracks = state.tracks.filter(
				(candidate) => candidate.id !== decodeURIComponent(track[1])
			);
			return {};
		}
		if (url === "/api/claude/timeline/project-1/elements/batch") {
			return { failedCount: 0 };
		}
		throw new Error(`fake: unexpected DELETE ${url}`);
	});
	return {
		client: { get, post, patch, delete: del } as unknown as EditorApiClient,
		get,
		post,
		patch,
		del,
		state,
	};
}

function callOrder(
	mock: ReturnType<typeof vi.fn>,
	test: (args: unknown[]) => boolean
) {
	const index = mock.mock.calls.findIndex((args) => test(args));
	if (index < 0) throw new Error("call not found");
	return mock.mock.invocationCallOrder[index];
}

describe("timeline apply: track switches and the mix", () => {
	it("colours, mutes and hides a track as it is made, and locks it after its clips are in", async () => {
		const editor = makeEditor();
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				media: [{ alias: "clip", mediaId: "media-1" }],
				tracks: [
					{
						alias: "sfx",
						type: "audio",
						name: "SFX",
						colorLabel: "red",
						muted: true,
						hidden: false,
						locked: true,
						elements: [
							{
								alias: "shot",
								type: "audio",
								media: "clip",
								startTime: 0,
								duration: 2,
							},
						],
					},
				],
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(editor.post).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/tracks",
			expect.objectContaining({
				type: "audio",
				name: "SFX",
				colorLabel: "red",
				muted: true,
				hidden: false,
			})
		);
		const createBody = editor.post.mock.calls.find(
			([url]) => url === "/api/claude/timeline/project-1/tracks"
		)?.[1] as Record<string, unknown>;
		expect(createBody.locked).toBeUndefined();
		const trackId = (result.data as { tracks: Record<string, string> }).tracks
			.sfx;
		const lockedAt = callOrder(
			editor.patch,
			([url, body]) =>
				url === `/api/claude/timeline/project-1/tracks/${trackId}` &&
				(body as Record<string, unknown>).locked === true
		);
		const clipsAt = callOrder(
			editor.post,
			([url]) => url === "/api/claude/timeline/project-1/elements/batch"
		);
		expect(lockedAt).toBeGreaterThan(clipsAt);
		expect(editor.state.tracks.find((t) => t.id === trackId)).toMatchObject({
			colorLabel: "red",
			muted: true,
			hidden: false,
			locked: true,
		});
	});

	it("creates buses, sets the master, routes track audio and maps ducking sources to new ids", async () => {
		const editor = makeEditor();
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				tracks: [
					{ alias: "voice", type: "audio", name: "Voice" },
					{
						alias: "music",
						type: "audio",
						name: "Music",
						audio: {
							gainDb: -6,
							pan: 0,
							solo: false,
							busId: "bgm",
							ducking: {
								enabled: true,
								sourceTrackIds: ["voice"],
								thresholdDb: -30,
							},
							autoCrossfade: { enabled: true, defaultDuration: 1 },
						},
					},
				],
				mix: {
					buses: [
						{
							id: "bgm",
							name: "BGM",
							gainDb: -3,
							effects: { limiter: { enabled: true } },
						},
					],
					master: { id: "master", name: "主输出", gainDb: -1 },
				},
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect((result.data as { mixApplied: boolean }).mixApplied).toBe(true);
		expect(editor.post).toHaveBeenCalledWith(
			"/api/claude/mix/project-1/buses",
			{
				id: "bgm",
				name: "BGM",
				gainDb: -3,
				effects: { limiter: { enabled: true } },
			}
		);
		// The master keeps its own name; only its settings change.
		expect(editor.patch).toHaveBeenCalledWith(
			"/api/claude/mix/project-1/buses/master",
			{ gainDb: -1 }
		);
		const ids = (result.data as { tracks: Record<string, string> }).tracks;
		expect(editor.patch).toHaveBeenCalledWith(
			`/api/claude/mix/project-1/tracks/${ids.music}`,
			{
				gainDb: -6,
				pan: 0,
				solo: false,
				busId: "bgm",
				ducking: {
					enabled: true,
					sourceTrackIds: [ids.voice],
					thresholdDb: -30,
				},
			}
		);
		expect(editor.state.master.name).toBe("Master");
	});

	it("with replace, removes the buses the manifest does not list", async () => {
		const editor = makeEditor({ buses: [{ id: "old", name: "Old" }] });
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				replace: true,
				tracks: [{ alias: "main", type: "media", name: "Main" }],
				mix: { buses: [{ id: "bgm", name: "BGM" }] },
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(editor.del).toHaveBeenCalledWith(
			"/api/claude/mix/project-1/buses/old"
		);
		expect(editor.state.buses.map((bus) => bus.id)).toEqual(["bgm"]);
	});

	it("rolls back and puts the mix back when the mix read-back differs", async () => {
		const editor = makeEditor({ masterIgnoresGain: true });
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				tracks: [{ alias: "music", type: "audio", name: "Music" }],
				mix: { buses: [{ id: "bgm", name: "BGM" }], master: { gainDb: -1 } },
			})
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("master field 'gainDb' did not match");
		expect(editor.post).toHaveBeenCalledWith(
			"/api/claude/transaction/transaction-1/rollback",
			expect.any(Object)
		);
		// The bus this apply made is gone again.
		expect(editor.del).toHaveBeenCalledWith(
			"/api/claude/mix/project-1/buses/bgm"
		);
		expect(editor.state.buses).toEqual([]);
	});

	it("merging into a timeline keeps its tracks in place and moves only a track that names an index", async () => {
		const editor = makeEditor({
			tracks: [
				{
					id: "main",
					name: "Main",
					type: "media",
					isMain: true,
					elements: [
						{ id: "clip-1", type: "media", startTime: 0, duration: 2 },
					],
				},
				{ id: "subs", name: "Subs", type: "text", elements: [] },
				{ id: "amb", name: "Ambience", type: "audio", elements: [] },
			],
		});
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				tracks: [
					{ trackId: "amb", type: "audio", name: "Ambience · wind" },
					{ alias: "titles", type: "text", name: "Titles", index: 0 },
					{ alias: "more", type: "audio", name: "Appended" },
				],
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(
			(result.data as { positionalTracks: boolean }).positionalTracks
		).toBe(false);
		expect(editor.patch).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/tracks/amb",
			{ name: "Ambience · wind" }
		);
		expect(editor.state.tracks.map((track) => track.name)).toEqual([
			"Titles",
			"Main",
			"Subs",
			"Ambience · wind",
			"Appended",
		]);
	});

	it("adds an exported, trimmed clip at its source length, not its trimmed length", async () => {
		const editor = makeEditor();
		// As `timeline export` writes it: `duration` is the 4.875 s left on the
		// timeline, trims are separate, and `timelineDuration` marks the shape.
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				replace: true,
				media: [{ alias: "clip", mediaId: "media-1" }],
				tracks: [
					{
						alias: "main",
						type: "media",
						name: "Main",
						elements: [
							{
								id: "clip-4",
								type: "media",
								media: "clip",
								startTime: 48.125,
								endTime: 53,
								duration: 4.875,
								timelineDuration: 4.875,
								trimStart: 12.583,
								trimEnd: 0,
							},
						],
					},
				],
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		const added = editor.post.mock.calls.find(
			([url]) => url === "/api/claude/timeline/project-1/elements/batch"
		)?.[1] as { elements: Array<Record<string, unknown>> };
		expect(added.elements[0].duration).toBeCloseTo(17.458, 3);
		expect(added.elements[0].trimStart).toBe(12.583);
		const stored = editor.state.tracks[0].elements[0];
		expect(stored.duration).toBeCloseTo(17.458, 3);
	});

	it("fails verification when a clip ends somewhere else than the manifest says", async () => {
		const editor = makeEditor();
		// The stand-in keeps the source length the manifest gave; a hand-written
		// manifest whose endTime disagrees with duration − trims is caught.
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				media: [{ alias: "clip", mediaId: "media-1" }],
				tracks: [
					{
						alias: "sfx",
						type: "audio",
						name: "SFX",
						elements: [
							{
								type: "audio",
								media: "clip",
								startTime: 0,
								duration: 10,
								trimEnd: 4,
								endTime: 10,
							},
						],
					},
				],
			})
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("field 'endTime' did not match");
	});

	it("chunks element updates by 50 with a deadline sized to each chunk", async () => {
		const elements = Array.from({ length: 60 }, (_, index) => ({
			id: `clip-${index}`,
			type: "media",
			startTime: index * 2,
			duration: 2,
		}));
		const editor = makeEditor({
			tracks: [
				{ id: "main", name: "Main", type: "media", isMain: true, elements },
			],
		});
		const result = await timelineApplyManifest(
			editor.client,
			makeOptions({
				tracks: [],
				updates: elements.map((element) => ({
					elementId: element.id,
					colorLabel: "blue",
				})),
			})
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		const batches = editor.patch.mock.calls.filter(
			([url]) => url === "/api/claude/timeline/project-1/elements/batch"
		);
		expect(
			batches.map(([, body]) => (body as { updates: unknown[] }).updates.length)
		).toEqual([50, 10]);
		expect(batches.map(([, , options]) => options)).toEqual([
			{ timeout: 110_000 },
			{ timeout: 70_000 },
		]);
	});
});
