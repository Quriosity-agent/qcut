import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addClaudeCaptionElement,
	addClaudeMarkdownElement,
	addClaudeRemotionElement,
} from "../claude-timeline-bridge-helpers";

/**
 * Markdown, caption and Remotion adds go through the same store call as media
 * and text: success returns the new id, and a refusal surfaces the store's
 * own reason instead of a bare "Failed to add".
 */

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "project-1" } })),
	},
}));

vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: vi.fn(() => ({ mediaItems: [] })) },
}));

const remotionFolderImport = vi.hoisted(() => vi.fn());

vi.mock("@qcut/platform-core", () => ({
	platform: vi.fn(() => ({
		projectFolder: undefined,
		remotionFolder: { import: remotionFolderImport },
	})),
}));

vi.mock("@/lib/remotion/component-loader", () => ({
	loadComponentsFromFolder: vi.fn(async () => ({
		success: true,
		components: [{ id: "intro" }, { id: "outro" }],
		errors: [],
	})),
}));

vi.mock("@/stores/ai/remotion-store", () => ({
	useRemotionStore: { getState: () => ({ registerComponent: vi.fn() }) },
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

type AddOptions = {
	collision?: string;
	onRejected?: (reason: string) => void;
};

function makeTimelineStore({
	refuseWith,
	refuseFrom = 1,
}: {
	refuseWith?: string;
	/** The first add (1-based) the store refuses. */
	refuseFrom?: number;
} = {}) {
	let adds = 0;
	return {
		tracks: [] as Array<{ id: string; type: string; elements: unknown[] }>,
		addTrack: vi.fn(() => "markdown-track"),
		addTrackByStackingPolicy: vi.fn(() => "markdown-track"),
		findOrCreateTrack: vi.fn((type: string) => `${type}-track`),
		updateElementDuration: vi.fn(),
		removeElementFromTrack: vi.fn(),
		addElementToTrack: vi.fn(
			(_trackId: string, _element: unknown, options?: AddOptions) => {
				adds++;
				if (!refuseWith || adds < refuseFrom) return `element-${adds}`;
				options?.onRejected?.(refuseWith);
				return null;
			}
		),
	};
}

const cases = [
	{
		type: "markdown",
		add: async (timelineStore: ReturnType<typeof makeTimelineStore>) =>
			addClaudeMarkdownElement({
				element: { type: "markdown", content: "# Notes", startTime: 0 },
				timelineStore: timelineStore as never,
			}),
	},
	{
		type: "caption",
		add: async (timelineStore: ReturnType<typeof makeTimelineStore>) =>
			addClaudeCaptionElement({
				element: { type: "captions", content: "Hello", startTime: 0 },
				timelineStore: timelineStore as never,
			}),
	},
	{
		type: "remotion",
		add: (timelineStore: ReturnType<typeof makeTimelineStore>) =>
			addClaudeRemotionElement({
				element: { type: "remotion", sourceId: "intro-card", startTime: 0 },
				projectId: "project-1",
				timelineStore: timelineStore as never,
			}),
	},
];

describe("overlay adds report the store's verdict", () => {
	beforeEach(() => vi.clearAllMocks());

	for (const { type, add } of cases) {
		it(`adds a ${type} element and returns its id`, async () => {
			const timelineStore = makeTimelineStore();
			await expect(add(timelineStore)).resolves.toBe("element-1");
			expect(timelineStore.addElementToTrack).toHaveBeenCalledWith(
				`${type === "caption" ? "captions" : type}-track`,
				expect.anything(),
				{ onRejected: expect.any(Function) }
			);
		});

		it(`passes on why a ${type} add was refused`, async () => {
			const timelineStore = makeTimelineStore({
				refuseWith: 'Track "Overlay" is locked',
			});
			await expect(add(timelineStore)).rejects.toThrow(
				`Failed to add ${type} element to the timeline: Track "Overlay" is locked`
			);
		});
	}
});

/** The element as the API sends it, with the request's collision policy. */
function withCollision<T extends object>(element: T, collision: string): T {
	return { ...element, collision };
}

// Review of PR #526: a request's own collision policy must reach the store
// before anything else changes the track.
describe("overlay adds with a collision policy", () => {
	beforeEach(() => vi.clearAllMocks());

	function markdownTrackWithClip() {
		const timelineStore = makeTimelineStore();
		timelineStore.tracks = [
			{
				id: "markdown-track",
				type: "markdown",
				elements: [
					{ id: "old", startTime: 0, duration: 5, trimStart: 0, trimEnd: 0 },
				],
			},
		];
		return timelineStore;
	}

	it("leaves the markdown clip in the way to the store's policy", async () => {
		const withPolicy = markdownTrackWithClip();
		addClaudeMarkdownElement({
			element: withCollision(
				{ type: "markdown", content: "# Notes", startTime: 2 },
				"reject"
			),
			timelineStore: withPolicy as never,
		});
		expect(withPolicy.updateElementDuration).not.toHaveBeenCalled();
		expect(withPolicy.addElementToTrack).toHaveBeenCalledWith(
			"markdown-track",
			expect.anything(),
			expect.objectContaining({ collision: "reject" })
		);

		// Without a policy the old clamp still makes room.
		const withoutPolicy = markdownTrackWithClip();
		addClaudeMarkdownElement({
			element: { type: "markdown", content: "# Notes", startTime: 2 },
			timelineStore: withoutPolicy as never,
		});
		expect(withoutPolicy.updateElementDuration).toHaveBeenCalledWith(
			"markdown-track",
			"old",
			2,
			false
		);

		const unknownPolicy = markdownTrackWithClip();
		expect(() =>
			addClaudeMarkdownElement({
				element: withCollision(
					{ type: "markdown", content: "# Notes", startTime: 2 },
					"squeeze"
				),
				timelineStore: unknownPolicy as never,
			})
		).toThrow("collision must be one of: reject, insert, overwrite");
		expect(unknownPolicy.updateElementDuration).not.toHaveBeenCalled();
	});

	it("passes the policy to every composition of a Remotion folder", async () => {
		remotionFolderImport.mockResolvedValue({
			success: true,
			bundle: { results: [] },
			scan: { compositions: [] },
		});
		const timelineStore = makeTimelineStore();
		await expect(
			addClaudeRemotionElement({
				element: withCollision(
					{
						type: "remotion",
						folderPath: "/compositions",
						startTime: 0,
						duration: 3,
					},
					"insert"
				),
				projectId: "project-1",
				timelineStore: timelineStore as never,
			})
		).resolves.toBe("element-1");
		expect(timelineStore.addElementToTrack).toHaveBeenCalledTimes(2);
		for (const call of timelineStore.addElementToTrack.mock.calls) {
			expect(call[2]).toMatchObject({ collision: "insert" });
		}
	});

	it("takes back a folder's first composition when the next is refused", async () => {
		remotionFolderImport.mockResolvedValue({
			success: true,
			bundle: { results: [] },
			scan: { compositions: [] },
		});
		const timelineStore = makeTimelineStore({
			refuseWith: "Overlaps outro",
			refuseFrom: 2,
		});
		await expect(
			addClaudeRemotionElement({
				element: { type: "remotion", folderPath: "/compositions" },
				projectId: "project-1",
				timelineStore: timelineStore as never,
			})
		).rejects.toThrow(
			"Failed to add remotion element to the timeline: Overlaps outro"
		);
		expect(timelineStore.removeElementFromTrack).toHaveBeenCalledWith(
			"remotion-track",
			"element-1",
			false
		);
	});

	it("refuses an unknown policy before importing the folder", async () => {
		const timelineStore = makeTimelineStore();
		await expect(
			addClaudeRemotionElement({
				element: withCollision(
					{ type: "remotion", folderPath: "/compositions" },
					"squeeze"
				),
				projectId: "project-1",
				timelineStore: timelineStore as never,
			})
		).rejects.toThrow("collision must be one of: reject, insert, overwrite");
		expect(remotionFolderImport).not.toHaveBeenCalled();
	});
});
