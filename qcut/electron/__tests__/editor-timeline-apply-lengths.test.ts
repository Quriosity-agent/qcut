/**
 * `editor timeline apply` and the lengths of trimmed clips (2026-11-08
 * report): the apply sends a clip's lengths as the manifest writes them, the
 * editor reads them (claude-media-add-lengths.ts, mirrored by the stand-in
 * below), and the read-back checks where each clip ends on the timeline even
 * when the manifest gives no `endTime` (Q2).
 */
import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineApplyManifest } from "../native-pipeline/editor/editor-timeline-apply.js";

type Clip = Record<string, unknown>;

function options(manifest: object): CLIRunOptions {
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
	} as CLIRunOptions;
}

const num = (value: unknown) => (typeof value === "number" ? value : 0);

/** The editor's reading of timeline export's lengths: the span before trims. */
function storedClip(clip: Clip): Clip {
	const { timelineDuration, endTime, ...rest } = clip;
	const trims = num(clip.trimStart) + num(clip.trimEnd);
	if (typeof timelineDuration === "number") {
		const afterTrims =
			typeof clip.duration === "number" ? clip.duration : timelineDuration;
		return { ...rest, duration: afterTrims + trims };
	}
	if (typeof endTime === "number" && clip.duration === undefined) {
		return { ...rest, duration: endTime - num(clip.startTime) + trims };
	}
	return rest;
}

/** What the bridge reports for a stored clip, as `timeline export` does. */
function readBack(clip: Clip): Clip {
	const afterTrims = Math.max(
		0,
		num(clip.duration) - num(clip.trimStart) - num(clip.trimEnd)
	);
	const span = afterTrims / (num(clip.playbackRate) || 1);
	return {
		...clip,
		duration: afterTrims,
		timelineDuration: span,
		endTime: num(clip.startTime) + span,
	};
}

/**
 * A stand-in editor with one empty main track. `place` changes a clip as the
 * editor stores it; `refuse` turns the batch down with that message.
 */
function standIn({
	place = (clip: Clip) => clip,
	refuse,
}: {
	place?: (clip: Clip) => Clip;
	refuse?: string;
} = {}) {
	const stored: Clip[] = [];
	const get = vi.fn(async (url: string) => {
		if (url === "/api/claude/navigator/projects") {
			return { activeProjectId: "project-1" };
		}
		if (url === "/api/claude/media/project-1") return [];
		if (url === "/api/claude/timeline/project-1") {
			return {
				tracks: [
					{
						id: "main",
						index: 0,
						name: "Main",
						type: "media",
						isMain: true,
						elements: stored.map(readBack),
						transitions: [],
					},
				],
			};
		}
		throw new Error(`stand-in: unexpected GET ${url}`);
	});
	const post = vi.fn(async (url: string, body: Clip) => {
		if (url === "/api/claude/navigator/open") return { navigated: true };
		if (url === "/api/claude/transaction/begin") {
			return { transactionId: "transaction-1" };
		}
		if (url.endsWith("/commit") || url.endsWith("/rollback")) return {};
		if (url === "/api/claude/timeline/project-1/elements/batch") {
			if (refuse) throw new Error(refuse);
			const clips = body.elements as Clip[];
			return {
				added: clips.map((clip, index) => {
					const id = `clip-${stored.length + 1}`;
					stored.push({ ...place(storedClip(clip)), id });
					return { index, success: true, elementId: id };
				}),
				failedCount: 0,
			};
		}
		throw new Error(`stand-in: unexpected POST ${url}`);
	});
	return {
		client: {
			get,
			post,
			patch: vi.fn(async () => ({ success: true })),
			delete: vi.fn(async () => ({ failedCount: 0 })),
		} as unknown as EditorApiClient,
		post,
		stored,
	};
}

function manifestOf(...elements: Clip[]) {
	return {
		replace: true,
		tracks: [{ alias: "main", type: "media", name: "Main", elements }],
	};
}

const clip = { type: "media", mediaId: "media-1" };

describe("timeline apply: lengths of trimmed clips", () => {
	it("sends a clip written as timeline export writes it, and verifies it", async () => {
		const editor = standIn();
		const exported = {
			...clip,
			alias: "shot-1",
			startTime: 1,
			endTime: 3,
			duration: 2,
			timelineDuration: 2,
			trimStart: 0.5,
			trimEnd: 1,
		};
		const result = await timelineApplyManifest(
			editor.client,
			options(manifestOf(exported))
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		const sent = editor.post.mock.calls.find(
			([url]) => url === "/api/claude/timeline/project-1/elements/batch"
		)?.[1] as { elements: Clip[] };
		expect(sent.elements[0]).toMatchObject({
			duration: 2,
			timelineDuration: 2,
			endTime: 3,
		});
		expect(editor.stored[0].duration).toBe(3.5);
	});

	it("sends an endTime alone for the editor to read as the clip's end", async () => {
		const editor = standIn();
		const result = await timelineApplyManifest(
			editor.client,
			options(manifestOf({ ...clip, startTime: 1, endTime: 4, trimStart: 2 }))
		);
		expect(result.success, JSON.stringify(result)).toBe(true);
		expect(editor.stored[0]).toMatchObject({ duration: 5, trimStart: 2 });
	});

	it("fails on where the clip ends when it was placed at another length (Q2)", async () => {
		// The manifest gives no endTime: 4 s before trims, trimEnd 1 s, so it
		// must end at 3 s. The stand-in plays it at double speed.
		const editor = standIn({
			place: (stored) => ({ ...stored, playbackRate: 2 }),
		});
		const result = await timelineApplyManifest(
			editor.client,
			options(manifestOf({ ...clip, startTime: 0, duration: 4, trimEnd: 1 }))
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("field 'endTime' did not match");
		expect(result.data).toEqual(expect.objectContaining({ rolledBack: true }));
	});

	it("compares the timelineDuration the manifest gave, not one worked out from duration", async () => {
		const editor = standIn();
		const result = await timelineApplyManifest(
			editor.client,
			options(
				manifestOf({ ...clip, startTime: 0, duration: 2, timelineDuration: 1 })
			)
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("field 'timelineDuration' did not match");
	});

	it("names a clip the editor refuses by its alias and rolls back (Q1, Q3)", async () => {
		const editor = standIn({
			refuse:
				'Element 1 ("media-1"): trimStart 5s and trimEnd 8s leave nothing of duration 2s, the clip\'s source span before its trims.',
		});
		const result = await timelineApplyManifest(
			editor.client,
			options(
				manifestOf(
					{ ...clip, alias: "开场1", startTime: 0, duration: 15 },
					{
						...clip,
						alias: "开场2",
						startTime: 15,
						duration: 2,
						trimStart: 5,
						trimEnd: 8,
					}
				)
			)
		);
		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Element '开场2' (\"media-1\"): trimStart 5s and trimEnd 8s leave nothing of duration 2s, the clip's source span before its trims."
		);
		expect(result.data).toEqual(expect.objectContaining({ rolledBack: true }));
		expect(editor.post).toHaveBeenCalledWith(
			"/api/claude/transaction/transaction-1/rollback",
			expect.any(Object)
		);
	});

	it("names no element for an unnumbered refusal of a longer batch", async () => {
		const message = "The clip's grade could not be applied";
		const editor = standIn({ refuse: message });
		const result = await timelineApplyManifest(
			editor.client,
			options(
				manifestOf(
					{ ...clip, alias: "a", startTime: 0, duration: 2 },
					{ ...clip, alias: "b", startTime: 2, duration: 2 }
				)
			)
		);
		expect(result.success).toBe(false);
		expect(result.error).toBe(message);
	});

	it("refuses a manifest element with no length above 0 before sending anything", async () => {
		const editor = standIn();
		const result = await timelineApplyManifest(
			editor.client,
			options(manifestOf({ ...clip, alias: "空", startTime: 0, endTime: 0 }))
		);
		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"The manifest has 1 problem; nothing was changed. Element '空' needs a length above 0: duration, timelineDuration (a clip) or endTime"
		);
		// Found in the manifest itself: the editor is not asked for anything.
		expect(editor.post).not.toHaveBeenCalled();
	});
});
