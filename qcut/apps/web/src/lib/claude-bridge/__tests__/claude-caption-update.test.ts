import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyElementChanges } from "../claude-timeline-bridge-elements";

const storeMocks = vi.hoisted(() => {
	const captionElement = {
		id: "caption",
		type: "captions" as const,
		name: "Caption",
		text: "Original",
		language: "en",
		source: "manual" as const,
		startTime: 1,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		style: {
			fontSize: 48,
			fontColor: "#ffffff",
			bold: false,
			shadowOffset: { x: 2, y: 4 },
		},
	};
	const state = {
		tracks: [
			{
				id: "captions-track",
				name: "Captions",
				type: "captions",
				elements: [captionElement],
			},
		],
		pushHistory: vi.fn(),
		updateElementStartTime: vi.fn(),
		updateElementTrim: vi.fn(),
		updateElementDuration: vi.fn(),
		updateCaptionElement: vi.fn(),
		updateMarkdownElement: vi.fn(),
		updateTextElement: vi.fn(),
		updateMediaElement: vi.fn(),
		updateMediaTiming: vi.fn(),
	};
	return { state };
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: {
		getState: vi.fn(() => storeMocks.state),
	},
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: null })),
	},
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

describe("Claude caption update bridge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies content, language and style changes to a caption", () => {
		const updated = applyElementChanges({
			elementId: "caption",
			changes: {
				content: "Changed",
				language: "zh",
				style: { fontColor: "#00ffcc", fontSize: 72 },
			},
			pushHistory: false,
		});

		expect(updated.applied).toBe(true);
		expect(storeMocks.state.updateCaptionElement).toHaveBeenCalledWith(
			"captions-track",
			"caption",
			{
				text: "Changed",
				language: "zh",
				style: { fontColor: "#00ffcc", fontSize: 72 },
			},
			false
		);
	});

	it("patches one shadow axis without losing the other", () => {
		applyElementChanges({
			elementId: "caption",
			changes: { shadowOffsetY: 8 },
			pushHistory: false,
		});

		expect(storeMocks.state.updateCaptionElement).toHaveBeenCalledWith(
			"captions-track",
			"caption",
			{ style: { shadowOffset: { x: 2, y: 8 } } },
			false
		);
	});

	it("sets and removes a bilingual caption's second line", () => {
		applyElementChanges({
			elementId: "caption",
			changes: { secondaryContent: " Round one " },
			pushHistory: false,
		});
		expect(storeMocks.state.updateCaptionElement).toHaveBeenLastCalledWith(
			"captions-track",
			"caption",
			{ secondaryText: "Round one" },
			false
		);

		applyElementChanges({
			elementId: "caption",
			changes: { secondaryContent: "" },
			pushHistory: false,
		});
		const [, , cleared] =
			storeMocks.state.updateCaptionElement.mock.calls.at(-1) ?? [];
		expect(cleared).toHaveProperty("secondaryText", undefined);
	});

	it("leaves the caption alone when only timing changes", () => {
		applyElementChanges({
			elementId: "caption",
			changes: { startTime: 3 },
			pushHistory: false,
		});

		expect(storeMocks.state.updateCaptionElement).not.toHaveBeenCalled();
		expect(storeMocks.state.updateElementStartTime).toHaveBeenCalled();
	});
});
