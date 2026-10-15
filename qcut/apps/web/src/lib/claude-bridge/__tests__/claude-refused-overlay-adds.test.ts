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

vi.mock("@qcut/platform-core", () => ({
	platform: vi.fn(() => ({ projectFolder: undefined })),
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

type AddOptions = { onRejected?: (reason: string) => void };

function makeTimelineStore({ refuseWith }: { refuseWith?: string } = {}) {
	return {
		tracks: [] as Array<{ id: string; type: string; elements: unknown[] }>,
		addTrack: vi.fn(() => "markdown-track"),
		findOrCreateTrack: vi.fn((type: string) => `${type}-track`),
		updateElementDuration: vi.fn(),
		addElementToTrack: vi.fn(
			(_trackId: string, _element: unknown, options?: AddOptions) => {
				if (!refuseWith) return "element-added";
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
			await expect(add(timelineStore)).resolves.toBe("element-added");
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
