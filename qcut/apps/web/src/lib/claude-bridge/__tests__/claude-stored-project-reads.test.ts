import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N23 (2026-10-30 trailer report): reading a project the editor does not
 * have open (timeline export, project stats) used to answer 409, or the
 * stats of whatever project was open. It now reads the project as storage
 * holds it, and the editor keeps what it has open.
 */

const storage = vi.hoisted(() => ({
	loadProject: vi.fn(),
	loadTimeline: vi.fn(),
	loadAllMediaSummaries: vi.fn(),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));

const project = vi.hoisted(() => ({
	onStatsRequest: vi.fn(),
	sendStatsResponse: vi.fn(),
}));
vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ claude: { project } }),
}));

import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";
import { setupClaudeProjectBridge } from "../claude-timeline-bridge";
import { setupRequestHandlers } from "../claude-timeline-bridge-request";
import type { ClaudeTimelineBridgeAPI } from "../claude-timeline-bridge";

const openTracks: TimelineTrack[] = [
	{ id: "open-main", name: "Main", type: "media", isMain: true, elements: [] },
];

const storedTracks: TimelineTrack[] = [
	{
		id: "main",
		name: "主轨道",
		type: "media",
		isMain: true,
		elements: [
			{
				id: "clip",
				type: "media",
				name: "clip on the timeline",
				mediaId: "media-1",
				startTime: 2,
				duration: 4,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
];

function requestTimeline(request: { requestId: string; projectId?: string }) {
	let handler: ((request: unknown) => Promise<void>) | undefined;
	const sendResponse = vi.fn();
	setupRequestHandlers({
		claudeAPI: {
			onRequest: (callback: typeof handler) => {
				handler = callback;
			},
			onApply: vi.fn(),
			sendResponse,
		} as unknown as ClaudeTimelineBridgeAPI,
	});
	return { done: handler?.(request), sendResponse };
}

beforeEach(() => {
	vi.clearAllMocks();
	useProjectStore.setState({
		loadedProjectId: "open",
		activeProject: { id: "open", name: "v21", fps: 24 } as never,
	});
	useTimelineStore.setState({ _tracks: openTracks, tracks: openTracks });
	storage.loadProject.mockResolvedValue({
		id: "v19",
		name: "定版 v19",
		fps: 24,
		currentSceneId: "scene-1",
		canvasSize: { width: 1470, height: 630 },
		updatedAt: new Date("2026-10-29T10:00:00Z"),
	});
	storage.loadTimeline.mockResolvedValue(storedTracks);
	storage.loadAllMediaSummaries.mockResolvedValue([
		{ id: "media-1", name: "05_拳域_01.mp4", type: "video" },
	]);
});

describe("timeline reads of a project that is not open", () => {
	it("answers from storage and leaves the editor on its own project", async () => {
		const { done, sendResponse } = requestTimeline({
			requestId: "r1",
			projectId: "v19",
		});
		await done;
		expect(storage.loadTimeline).toHaveBeenCalledWith({
			projectId: "v19",
			sceneId: "scene-1",
		});
		const [timeline, requestId] = sendResponse.mock.calls[0];
		expect(requestId).toBe("r1");
		expect(timeline).toMatchObject({
			projectId: "v19",
			name: "定版 v19",
			width: 1470,
			height: 630,
			fps: 24,
			readFromStorage: true,
			tracks: [
				{
					id: "main",
					elements: [
						{ id: "clip", sourceId: "media-1", sourceName: "05_拳域_01.mp4" },
					],
				},
			],
		});
		expect(useProjectStore.getState().loadedProjectId).toBe("open");
		expect(useTimelineStore.getState().tracks).toBe(openTracks);
	});

	it("answers the open project from the editor", async () => {
		const { done, sendResponse } = requestTimeline({
			requestId: "r2",
			projectId: "open",
		});
		await done;
		expect(storage.loadProject).not.toHaveBeenCalled();
		const [timeline] = sendResponse.mock.calls[0];
		expect(timeline.projectId).toBe("open");
		expect(timeline.readFromStorage).toBeUndefined();
		expect(timeline.tracks.map((track: { id: string }) => track.id)).toEqual([
			"open-main",
		]);
	});

	it("says a project storage does not have was not found", async () => {
		storage.loadProject.mockResolvedValueOnce(null);
		const { done, sendResponse } = requestTimeline({
			requestId: "r3",
			projectId: "gone",
		});
		await done;
		expect(sendResponse).toHaveBeenCalledWith(
			null,
			"r3",
			"Project gone was not found"
		);
	});
});

describe("project stats of a project that is not open", () => {
	it("counts the stored project rather than the open one", async () => {
		setupClaudeProjectBridge();
		const [onStats] = project.onStatsRequest.mock.calls[0];
		await onStats("v19", "stats-1");
		expect(project.sendStatsResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				trackCount: 1,
				elementCount: 1,
				mediaCount: { video: 1, audio: 0, image: 0 },
				totalDuration: 6,
				lastModified: new Date("2026-10-29T10:00:00Z").getTime(),
			}),
			"stats-1"
		);
	});

	it("counts the open project from the editor", async () => {
		setupClaudeProjectBridge();
		const [onStats] = project.onStatsRequest.mock.calls[0];
		await onStats("open", "stats-open");
		expect(storage.loadProject).not.toHaveBeenCalled();
		expect(project.sendStatsResponse).toHaveBeenCalledWith(
			expect.objectContaining({ trackCount: 1, elementCount: 0 }),
			"stats-open"
		);
	});

	it("counts nothing for a project storage does not have, not the open one", async () => {
		storage.loadProject.mockResolvedValueOnce(null);
		setupClaudeProjectBridge();
		const [onStats] = project.onStatsRequest.mock.calls[0];
		await onStats("gone", "stats-2");
		expect(project.sendStatsResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				trackCount: 0,
				elementCount: 0,
				mediaCount: { video: 0, audio: 0, image: 0 },
				totalDuration: 0,
			}),
			"stats-2"
		);
	});
});
