import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import type { TProject } from "@/types/project";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/timeline/scene-store";
import { useMediaStore } from "@/stores/media/media-store";
import {
	runSmartShotSplit,
	type AnalyzeScenesForShotSplit,
} from "../smart-shot-split";

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveProjectTimeline: vi.fn(async () => {}),
		saveProject: vi.fn(async () => {}),
	},
}));

const FPS = 24;
const source: MediaElement = {
	id: "clip",
	type: "media",
	mediaId: "media",
	name: "Video",
	startTime: 10,
	duration: 12,
	trimStart: 2,
	trimEnd: 2,
};
const request = { projectId: "project", trackId: "track", elementId: "clip" };

beforeEach(() => {
	const scene = {
		id: "scene",
		name: "Main",
		isMain: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const project: TProject = {
		id: "project",
		name: "Test",
		thumbnail: "",
		createdAt: new Date(),
		updatedAt: new Date(),
		scenes: [scene],
		currentSceneId: scene.id,
		fps: FPS,
		canvasSize: { width: 1920, height: 1080 },
		canvasMode: "preset",
	};
	useProjectStore.setState({ activeProject: project, isLoading: false });
	useSceneStore.setState({ currentScene: scene, scenes: [scene] });
	const tracks: TimelineTrack[] = [
		{
			id: "track",
			type: "media",
			name: "Main",
			isMain: true,
			elements: [structuredClone(source)],
		},
	];
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
		selectedElements: [],
		selectedTransition: null,
	});
	useMediaStore.setState({
		mediaItems: [
			{
				id: "media",
				name: "Video",
				type: "video",
				localPath: "/test/source.mp4",
				url: "blob:test-video",
				file: new File(["video"], "source.mp4", { type: "video/mp4" }),
			},
		],
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("runSmartShotSplit", () => {
	it("snaps given cuts to the project's frame grid and reports them as manual", async () => {
		const result = await runSmartShotSplit({
			...request,
			cuts: [5.1],
			dryRun: true,
			analyzeScenes: vi.fn() as unknown as AnalyzeScenesForShotSplit,
		});
		// 5.1 s × 24 = 122.4 → frame 122
		expect(result.cuts).toEqual([
			{ sourceTime: 122 / FPS, timelineTime: 10 + 122 / FPS - 2 },
		]);
		expect(result.requestedEngine).toBe("manual");
		expect(result.engine).toBe("manual");
		expect(result.message).toBeUndefined();
		expect(result.createdElementIds).toEqual([]);
	});

	it("says so when the engine finds no boundary in the clip", async () => {
		const analyzeScenes: AnalyzeScenesForShotSplit = vi.fn(async () => ({
			engine: "jianying" as const,
			route: "bridge",
			scenes: [{ timestamp: 0, confidence: 1 }],
		}));
		const result = await runSmartShotSplit({
			...request,
			engine: "jianying",
			analyzeScenes,
		});
		expect(result).toMatchObject({
			engine: "jianying",
			cuts: [],
			skipped: [],
			message: "jianying found no shot boundary in the clip's source",
			createdElementIds: [],
		});
		expect(useTimelineStore.getState().history).toEqual([]);
	});

	it("reports detection failures without Electron's remote-method wrapper", async () => {
		const analyzeScenes: AnalyzeScenesForShotSplit = vi.fn(async () => {
			throw new Error(
				"Error invoking remote method 'claude:analyze:scenes': Error: ONNX shot-split contract missing"
			);
		});
		await expect(
			runSmartShotSplit({ ...request, engine: "onnx", analyzeScenes })
		).rejects.toThrow(/^ONNX shot-split contract missing$/);
	});
});
