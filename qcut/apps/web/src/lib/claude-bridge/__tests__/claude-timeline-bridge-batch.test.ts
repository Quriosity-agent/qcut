import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBatchHandlers } from "../claude-timeline-bridge-batch";
import type {
	ClaudeTimelineBridgeAPI,
	ClaudeTimelineBridgeSharedUtils,
} from "../claude-timeline-bridge";

const storeMocks = vi.hoisted(() => {
	const track = {
		id: "track-1",
		name: "Main Video",
		type: "media",
		elements: [] as Array<{
			id: string;
			type: "media";
			startTime: number;
			duration: number;
			trimStart: number;
			trimEnd: number;
			enhancements?: Record<string, number>;
		}>,
	};
	const state = {
		tracks: [track],
		pushHistory: vi.fn(),
		addElementToTrack: vi.fn(),
		updateElementStartTime: vi.fn(() => true),
		updateElementTrim: vi.fn(),
		updateElementDuration: vi.fn(),
		updateMarkdownElement: vi.fn(),
		updateTextElement: vi.fn(),
		updateMediaElement: vi.fn(),
		updateMediaTiming: vi.fn(),
		removeElementFromTrack: vi.fn(),
		setColorLabelForElements: vi.fn(),
		saveImmediate: vi.fn(async () => undefined),
	};
	return { state, track };
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: {
		getState: vi.fn(() => storeMocks.state),
	},
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "project-1" } })),
	},
}));

vi.mock("@/lib/project/project-folder-sync", () => ({
	syncProjectFolder: vi.fn(async () => undefined),
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugError: vi.fn(),
}));

describe("Claude timeline batch bridge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storeMocks.track.elements = [];
		storeMocks.state.addElementToTrack.mockImplementation(
			(
				_trackId: string,
				element: {
					type: "media";
					startTime: number;
					duration: number;
					trimStart: number;
					trimEnd: number;
				}
			) => {
				storeMocks.track.elements.push({
					...element,
					id: "element-1",
				});
				return "element-1";
			}
		);
	});

	it("creates media elements with source trims", async () => {
		let batchHandler:
			| ((data: {
					requestId: string;
					projectId: string;
					elements: Array<Record<string, unknown>>;
			  }) => Promise<void>)
			| undefined;
		const sendResponse = vi.fn();
		const claudeAPI = {
			onBatchAddElements: vi.fn(
				(
					handler: (data: {
						requestId: string;
						projectId: string;
						elements: Array<Record<string, unknown>>;
					}) => Promise<void>
				) => {
					batchHandler = handler;
				}
			),
			sendBatchAddElementsResponse: sendResponse,
		} as unknown as ClaudeTimelineBridgeAPI;
		const sharedUtils = {
			normalizeClaudeElementType: vi.fn(() => "media"),
			resolveMediaIdForBatchElement: vi.fn(() => "media-1"),
		} as unknown as ClaudeTimelineBridgeSharedUtils;

		setupBatchHandlers({ claudeAPI, sharedUtils });
		expect(batchHandler).toBeDefined();
		await batchHandler?.({
			requestId: "request-1",
			projectId: "project-1",
			elements: [
				{
					type: "media",
					trackId: "track-1",
					sourceId: "media-1",
					sourceName: "yarra.mp4",
					startTime: 3.295,
					duration: 20,
					trimStart: 2.4,
					trimEnd: 11.9,
					playbackRate: 1.5,
					reverse: true,
					colorLabel: "blue",
				},
			],
		});

		expect(storeMocks.state.addElementToTrack).toHaveBeenCalledWith(
			"track-1",
			expect.objectContaining({
				trimStart: 2.4,
				trimEnd: 11.9,
				playbackRate: 1.5,
				reverse: true,
				colorLabel: "blue",
			}),
			{
				pushHistory: false,
				selectElement: false,
				onRejected: expect.any(Function),
			}
		);
		expect(sendResponse).toHaveBeenCalledWith("request-1", {
			added: [{ index: 0, success: true, elementId: "element-1" }],
			failedCount: 0,
		});

		storeMocks.state.addElementToTrack.mockClear();
		await batchHandler?.({
			requestId: "request-invalid-collision",
			projectId: "project-1",
			elements: [
				{
					type: "media",
					trackId: "track-1",
					sourceId: "media-1",
					startTime: 0,
					duration: 2,
					collision: "merge",
				},
			],
		});

		expect(storeMocks.state.addElementToTrack).not.toHaveBeenCalled();
		expect(sendResponse).toHaveBeenCalledWith("request-invalid-collision", {
			added: [
				{
					index: 0,
					success: false,
					error: "Unsupported collision policy: merge",
				},
			],
			failedCount: 1,
		});
	});

	it("reports the store's reason when it refuses an add", async () => {
		let batchHandler:
			| ((data: {
					requestId: string;
					projectId: string;
					elements: Array<Record<string, unknown>>;
			  }) => Promise<void>)
			| undefined;
		const sendResponse = vi.fn();
		const claudeAPI = {
			onBatchAddElements: vi.fn(
				(
					handler: (data: {
						requestId: string;
						projectId: string;
						elements: Array<Record<string, unknown>>;
					}) => Promise<void>
				) => {
					batchHandler = handler;
				}
			),
			sendBatchAddElementsResponse: sendResponse,
		} as unknown as ClaudeTimelineBridgeAPI;
		const sharedUtils = {
			normalizeClaudeElementType: vi.fn(() => "media"),
			resolveMediaIdForBatchElement: vi.fn(() => "media-1"),
		} as unknown as ClaudeTimelineBridgeSharedUtils;
		const reason =
			'117.25s–133.291667s on track "Main Video" overlaps "clip 8" (117.3s–121.3s).';
		storeMocks.state.addElementToTrack.mockImplementation(
			(
				_trackId: string,
				_element: unknown,
				options: { onRejected?: (reason: string) => void }
			) => {
				options.onRejected?.(reason);
				return null;
			}
		);

		setupBatchHandlers({ claudeAPI, sharedUtils });
		await batchHandler?.({
			requestId: "request-refused",
			projectId: "project-1",
			elements: [
				{
					type: "media",
					trackId: "track-1",
					sourceId: "media-1",
					startTime: 117.25,
					duration: 16.041667,
				},
			],
		});

		expect(sendResponse).toHaveBeenCalledWith("request-refused", {
			added: [{ index: 0, success: false, error: reason }],
			failedCount: 1,
		});
	});

	it("persists batch updates before acknowledging nested and flat shapes", async () => {
		storeMocks.track.elements = [
			{
				id: "clip",
				type: "media",
				startTime: 0,
				duration: 8,
				trimStart: 0,
				trimEnd: 0,
			},
		];

		let updateHandler:
			| ((data: {
					requestId: string;
					updates: Array<Record<string, unknown>>;
			  }) => Promise<void>)
			| undefined;
		const sendResponse = vi.fn();
		const claudeAPI = {
			onBatchUpdateElements: vi.fn(
				(
					handler: (data: {
						requestId: string;
						updates: Array<Record<string, unknown>>;
					}) => Promise<void>
				) => {
					updateHandler = handler;
				}
			),
			sendBatchUpdateElementsResponse: sendResponse,
		} as unknown as ClaudeTimelineBridgeAPI;

		setupBatchHandlers({
			claudeAPI,
			sharedUtils: {} as ClaudeTimelineBridgeSharedUtils,
		});
		expect(updateHandler).toBeDefined();
		await updateHandler?.({
			requestId: "request-2",
			updates: [
				// Documented nested shape — previously silently ignored
				{ elementId: "clip", changes: { startTime: 7 } },
				// Legacy flat shape — must keep working
				{ elementId: "clip", startTime: 9 },
				{ elementId: "clip", changes: { colorLabel: "rose" } },
				{
					elementId: "clip",
					changes: { enhancements: { labEyeCorrection: 60 } },
				},
			],
		});

		expect(storeMocks.state.updateElementStartTime).toHaveBeenNthCalledWith(
			1,
			"track-1",
			"clip",
			7,
			false
		);
		expect(storeMocks.state.updateElementStartTime).toHaveBeenNthCalledWith(
			2,
			"track-1",
			"clip",
			9,
			false
		);
		expect(storeMocks.state.setColorLabelForElements).toHaveBeenCalledWith({
			elements: [{ trackId: "track-1", elementId: "clip" }],
			colorLabel: "rose",
			pushHistory: false,
		});
		expect(storeMocks.state.updateMediaElement).toHaveBeenCalledWith(
			"track-1",
			"clip",
			{
				enhancements: expect.objectContaining({
					labEyeCorrection: 60,
					stabilization: 0,
					upscale: 1,
				}),
			},
			false
		);
		expect(storeMocks.state.saveImmediate).toHaveBeenCalledOnce();
		expect(
			storeMocks.state.saveImmediate.mock.invocationCallOrder[0]
		).toBeLessThan(sendResponse.mock.invocationCallOrder[0]);
		expect(sendResponse).toHaveBeenCalledWith("request-2", {
			updatedCount: 4,
			failedCount: 0,
			results: [
				{ index: 0, success: true },
				{ index: 1, success: true },
				{ index: 2, success: true },
				{ index: 3, success: true },
			],
		});
	});
});

describe("Claude timeline batch audio fades", () => {
	function setupAddHandler() {
		let batchHandler:
			| ((data: {
					requestId: string;
					projectId: string;
					elements: Array<Record<string, unknown>>;
			  }) => Promise<void>)
			| undefined;
		const sendResponse = vi.fn();
		const claudeAPI = {
			onBatchAddElements: vi.fn(
				(
					handler: (data: {
						requestId: string;
						projectId: string;
						elements: Array<Record<string, unknown>>;
					}) => Promise<void>
				) => {
					batchHandler = handler;
				}
			),
			sendBatchAddElementsResponse: sendResponse,
		} as unknown as ClaudeTimelineBridgeAPI;
		const sharedUtils = {
			normalizeClaudeElementType: vi.fn(() => "media"),
			resolveMediaIdForBatchElement: vi.fn(() => "media-1"),
		} as unknown as ClaudeTimelineBridgeSharedUtils;
		setupBatchHandlers({ claudeAPI, sharedUtils });
		if (!batchHandler) throw new Error("Batch handler was not registered");
		return { batchHandler, sendResponse };
	}

	const baseAudio = {
		type: "media",
		trackId: "track-1",
		sourceId: "media-1",
		startTime: 0,
	};

	it("maps fadeIn/fadeOut onto audioFadeIn/audioFadeOut across playback rates", async () => {
		const { batchHandler, sendResponse } = setupAddHandler();
		// Each case fills the clip's timeline span exactly with its fades:
		// span = (duration - trims) / rate.
		const cases = [
			// 1×: (10 - 1 - 1) / 1 = 8s span; 3 + 5 fades fit.
			{ duration: 10, trimStart: 1, trimEnd: 1, fadeIn: 3, fadeOut: 5 },
			// 2×: (10 - 2 - 0) / 2 = 4s span; a 4s fade only fits at 2×.
			{
				duration: 10,
				trimStart: 2,
				trimEnd: 0,
				playbackRate: 2,
				fadeIn: 4,
				fadeOut: 0,
			},
			// 0.5×: (6 - 1 - 1) / 0.5 = 8s span; 8s fade-out fits only slowed.
			{
				duration: 6,
				trimStart: 1,
				trimEnd: 1,
				playbackRate: 0.5,
				fadeIn: 0,
				fadeOut: 8,
			},
		];
		await batchHandler({
			requestId: "request-fades",
			projectId: "project-1",
			elements: cases.map((partial) => ({ ...baseAudio, ...partial })),
		});

		expect(sendResponse).toHaveBeenCalledWith("request-fades", {
			added: [
				{ index: 0, success: true, elementId: "element-1" },
				{ index: 1, success: true, elementId: "element-1" },
				{ index: 2, success: true, elementId: "element-1" },
			],
			failedCount: 0,
		});
		const storedElements = storeMocks.state.addElementToTrack.mock.calls.map(
			(call) => call[1] as Record<string, unknown>
		);
		expect(storedElements[0]).toMatchObject({
			audioFadeIn: 3,
			audioFadeOut: 5,
			trimStart: 1,
			trimEnd: 1,
		});
		expect(storedElements[1]).toMatchObject({
			audioFadeIn: 4,
			audioFadeOut: 0,
			playbackRate: 2,
		});
		expect(storedElements[2]).toMatchObject({
			audioFadeIn: 0,
			audioFadeOut: 8,
			playbackRate: 0.5,
		});
	});

	it("prefers explicit audioFadeIn/audioFadeOut over the fade aliases", async () => {
		const { batchHandler } = setupAddHandler();
		await batchHandler({
			requestId: "request-alias",
			projectId: "project-1",
			elements: [
				{
					...baseAudio,
					duration: 10,
					fadeIn: 9,
					audioFadeIn: 1,
					audioFadeOut: 2,
				},
			],
		});
		const [, stored] = storeMocks.state.addElementToTrack.mock.calls[0];
		expect(stored).toMatchObject({ audioFadeIn: 1, audioFadeOut: 2 });
	});

	it("rejects negative, non-finite, and over-length fades", async () => {
		const { batchHandler, sendResponse } = setupAddHandler();
		await batchHandler({
			requestId: "request-bad-fades",
			projectId: "project-1",
			elements: [
				{ ...baseAudio, duration: 10, fadeIn: -1 },
				{ ...baseAudio, duration: 10, fadeOut: Number.NaN },
				// 2×: (10 - 0 - 0) / 2 = 5s span; a 6s fade no longer fits.
				{ ...baseAudio, duration: 10, playbackRate: 2, fadeIn: 6 },
				// Same 6s fade fits at 1× — proves the rate is what rejects it.
				{ ...baseAudio, duration: 10, fadeIn: 6 },
			],
		});

		expect(storeMocks.state.addElementToTrack).toHaveBeenCalledTimes(1);
		expect(sendResponse).toHaveBeenCalledWith("request-bad-fades", {
			added: [
				{
					index: 0,
					success: false,
					error: "audioFadeIn must be a non-negative finite number",
				},
				{
					index: 1,
					success: false,
					error: "audioFadeOut must be a non-negative finite number",
				},
				{
					index: 2,
					success: false,
					error: "audioFadeIn (6s) must fit inside the clip's 5s timeline span",
				},
				{ index: 3, success: true, elementId: "element-1" },
			],
			failedCount: 3,
		});
	});

	it("adds media with volume keyframes and rejects malformed audio", async () => {
		const { batchHandler, sendResponse } = setupAddHandler();
		await batchHandler({
			requestId: "request-audio",
			projectId: "project-1",
			elements: [
				{
					...baseAudio,
					duration: 10,
					volume: 0.5,
					audio: {
						keyframes: {
							volumeDb: [
								{ frame: 60, value: -18 },
								{ frame: 0, value: 0 },
							],
						},
					},
				},
				{
					...baseAudio,
					duration: 10,
					audio: { keyframes: { volumeDb: [{ frame: -1, value: 0 }] } },
				},
			],
		});

		expect(sendResponse).toHaveBeenCalledWith("request-audio", {
			added: [
				{ index: 0, success: true, elementId: "element-1" },
				{
					index: 1,
					success: false,
					error:
						"audio.keyframes.volumeDb[0].frame must be a whole number of frames >= 0",
				},
			],
			failedCount: 1,
		});
		expect(storeMocks.state.addElementToTrack).toHaveBeenCalledTimes(1);
		const [, stored] = storeMocks.state.addElementToTrack.mock.calls[0];
		expect(stored).toMatchObject({
			volume: 0.5,
			audio: {
				keyframes: {
					volumeDb: [
						{ id: "volumeDb-0", frame: 0, value: 0, easing: "linear" },
						{ id: "volumeDb-60", frame: 60, value: -18, easing: "linear" },
					],
				},
			},
		});
	});
	it("keeps a clip's name, placement, fit mode and grade, like an export round-trip", async () => {
		const { batchHandler, sendResponse } = setupAddHandler();
		await batchHandler({
			requestId: "request-visual",
			projectId: "project-1",
			elements: [
				{
					...baseAudio,
					name: "02_改名测试",
					duration: 10,
					fitMode: "contain",
					x: 12,
					y: -30,
					rotation: 5,
					scaleX: 1.2,
					scaleY: 0.8,
					opacity: 0.5,
					blendMode: "screen",
					blendEnabled: false,
					color: { basic: { contrast: 20 } },
				},
			],
		});
		expect(sendResponse).toHaveBeenCalledWith("request-visual", {
			added: [{ index: 0, success: true, elementId: "element-1" }],
			failedCount: 0,
		});
		const [, stored] = storeMocks.state.addElementToTrack.mock.calls[0];
		expect(stored).toMatchObject({
			name: "02_改名测试",
			fitMode: "contain",
			x: 12,
			y: -30,
			rotation: 5,
			scaleX: 1.2,
			scaleY: 0.8,
			opacity: 0.5,
			blendMode: "screen",
			blendEnabled: false,
		});
		// The grade goes through the patch path once the clip exists.
		expect(storeMocks.state.updateMediaElement).toHaveBeenCalledWith(
			"track-1",
			"element-1",
			expect.objectContaining({
				color: expect.objectContaining({
					basic: expect.objectContaining({ contrast: 20 }),
				}),
				adjustments: expect.objectContaining({ contrast: 20 }),
			}),
			false
		);
	});

	it("refuses a bad fit mode before adding and removes a clip whose grade is refused", async () => {
		const { batchHandler, sendResponse } = setupAddHandler();
		await batchHandler({
			requestId: "request-bad-visual",
			projectId: "project-1",
			elements: [
				{ ...baseAudio, duration: 10, fitMode: "stretch" },
				{ ...baseAudio, duration: 10, color: "red" },
				{ ...baseAudio, duration: 10, blendMode: "dissolve" },
			],
		});
		expect(sendResponse).toHaveBeenCalledWith("request-bad-visual", {
			added: [
				{
					index: 0,
					success: false,
					error: "fitMode must be one of cover, contain, fill",
				},
				{
					index: 1,
					success: false,
					error: "color must be an object (a partial colour grade)",
				},
				{
					index: 2,
					success: false,
					error:
						"blendMode must be one of normal, multiply, screen, overlay, darken, lighten",
				},
			],
			failedCount: 3,
		});
		// Only the second element reached the store, and it was taken out again.
		expect(storeMocks.state.addElementToTrack).toHaveBeenCalledTimes(1);
		expect(storeMocks.state.removeElementFromTrack).toHaveBeenCalledWith(
			"track-1",
			"element-1",
			false
		);
	});
});
