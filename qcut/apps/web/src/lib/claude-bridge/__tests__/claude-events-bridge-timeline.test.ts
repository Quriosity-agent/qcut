import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A store reduced to what the events bridge uses: read, write, subscribe. */
function fakeStore<T extends object>(initial: T) {
	let state = initial;
	const listeners = new Set<(state: T) => void>();
	return {
		getState: () => state,
		setState: (patch: Partial<T>) => {
			state = { ...state, ...patch };
			for (const listener of listeners) listener(state);
		},
		subscribe: (listener: (state: T) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		listenerCount: () => listeners.size,
	};
}

const mocks = vi.hoisted(() => ({
	emit: vi.fn(),
	stores: {} as Record<string, unknown>,
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ claude: { events: { emit: mocks.emit } } }),
}));
vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: new Proxy(
		{},
		{ get: (_target, key) => (mocks.stores.timeline as never)[key] }
	),
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: new Proxy(
		{},
		{ get: (_target, key) => (mocks.stores.media as never)[key] }
	),
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: new Proxy(
		{},
		{ get: (_target, key) => (mocks.stores.project as never)[key] }
	),
}));
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: new Proxy(
		{},
		{ get: (_target, key) => (mocks.stores.editor as never)[key] }
	),
}));
vi.mock("@/stores/editor/playback-store", () => ({
	usePlaybackStore: new Proxy(
		{},
		{ get: (_target, key) => (mocks.stores.playback as never)[key] }
	),
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

import {
	cleanupClaudeEventsBridge,
	setupClaudeEventsBridge,
} from "../claude-events-bridge";

interface Clip {
	id: string;
	type: string;
	name: string;
	startTime: number;
	duration: number;
	color?: { lut: { cube: { size: number; values: number[] } } };
}

const clip = ({ id, name = id }: { id: string; name?: string }): Clip => ({
	id,
	type: "media",
	name,
	startTime: 0,
	duration: 1,
});

const track = (elements: Clip[]) => ({
	id: "main",
	name: "Main",
	type: "media",
	elements,
});

function timelineEvents() {
	return mocks.emit.mock.calls
		.map(
			([event]) => event as { category: string; data: Record<string, unknown> }
		)
		.filter((event) => event.category.startsWith("timeline."));
}

describe("timeline events from the editor", () => {
	let timeline: ReturnType<typeof fakeStore<Record<string, unknown>>>;

	beforeEach(() => {
		mocks.emit.mockClear();
		timeline = fakeStore<Record<string, unknown>>({
			tracks: [track([clip({ id: "a" })])],
			selectedElements: [],
			isAutoSaving: false,
		});
		mocks.stores.timeline = timeline;
		mocks.stores.media = fakeStore({ mediaItems: [] });
		mocks.stores.project = fakeStore({ activeProject: { id: "project-1" } });
		mocks.stores.editor = fakeStore({
			canvasSize: { width: 1920, height: 1080 },
			canvasMode: "preset",
		});
		mocks.stores.playback = fakeStore({ currentTime: 0, isPlaying: false });
		setupClaudeEventsBridge();
	});

	afterEach(() => {
		cleanupClaudeEventsBridge();
	});

	it("reports an added, a changed and a removed clip, each once", () => {
		const a = clip({ id: "a" });
		timeline.setState({ tracks: [track([a])] });
		expect(timelineEvents()).toEqual([]);

		const b = clip({ id: "b" });
		timeline.setState({ tracks: [track([a, b])] });
		const renamed = { ...b, name: "renamed" };
		timeline.setState({ tracks: [track([a, renamed])] });
		timeline.setState({ tracks: [track([renamed])] });

		expect(
			timelineEvents().map((event) => [
				event.category,
				event.data.elementId,
				event.data.projectId,
			])
		).toEqual([
			["timeline.elementAdded", "b", "project-1"],
			["timeline.elementUpdated", "b", "project-1"],
			["timeline.elementRemoved", "a", "project-1"],
		]);
		const updated = timelineEvents()[1].data as {
			before: Clip;
			after: Clip;
		};
		expect(updated.before.name).toBe("b");
		expect(updated.after.name).toBe("renamed");
	});

	/**
	 * 问题 1 (2026-11-14): every store update re-read every clip, LUT and
	 * all, so a clip added to a graded timeline cost the whole timeline.
	 */
	it("reads a clip again only when the store replaced it", () => {
		const cube = { size: 18, values: new Array(18 ** 3 * 3).fill(0.5) };
		const graded = Array.from({ length: 60 }, (_, index) => ({
			...clip({ id: `graded-${index}` }),
			color: { lut: { cube } },
		}));
		timeline.setState({ tracks: [track(graded)] });
		mocks.emit.mockClear();

		const stringify = vi.spyOn(JSON, "stringify");
		try {
			// Save status and the like: the timeline itself did not change.
			timeline.setState({ isAutoSaving: true });
			timeline.setState({ isAutoSaving: false });
			const forStatus = stringify.mock.calls.filter(
				([value]) => (value as Clip | undefined)?.color !== undefined
			).length;
			expect(forStatus).toBe(0);

			stringify.mockClear();
			timeline.setState({
				tracks: [track([...graded, clip({ id: "new" })])],
			});
			const clipsRead = stringify.mock.calls.filter(
				([value]) => typeof (value as Clip | undefined)?.startTime === "number"
			).length;
			expect(clipsRead).toBe(1);
		} finally {
			stringify.mockRestore();
		}
		expect(timelineEvents().map((event) => event.data.elementId)).toEqual([
			"new",
		]);
	});

	it("stops listening when the bridge is cleaned up", () => {
		expect(timeline.listenerCount()).toBe(1);
		cleanupClaudeEventsBridge();
		expect(timeline.listenerCount()).toBe(0);
		timeline.setState({ tracks: [track([])] });
		expect(timelineEvents()).toEqual([]);
	});
});
