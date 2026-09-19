import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneDetectionResult } from "../../../../../../../electron/types/claude-api";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import type { TProject } from "@/types/project";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/timeline/scene-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useCloudTaskStore } from "@/stores/cloud-task-store";
import {
	clearAllCloudTaskRuntimeActions,
	getCloudTaskRuntimeActions,
} from "@/lib/cloud-tasks/task-runtime-actions";
import { runTimelineSmartShotSplit } from "../timeline-element";

const mocks = vi.hoisted(() => ({
	scenes: vi.fn(),
	save: vi.fn(async () => {}),
	error: vi.fn(),
}));

vi.mock("@qcut/platform-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@qcut/platform-core")>()),
	platform: () => ({ claude: { analyze: { scenes: mocks.scenes } } }),
}));
vi.mock("@/lib/storage/storage-service", () => ({
	storageService: { saveProjectTimeline: mocks.save, saveProject: mocks.save },
}));
vi.mock("sonner", () => ({
	toast: {
		loading: vi.fn(() => "toast-id"),
		success: vi.fn(),
		info: vi.fn(),
		error: mocks.error,
		dismiss: vi.fn(),
	},
}));
vi.mock("../video-timeline-clip", () => ({ VideoTimelineClip: () => null }));
vi.mock("../../audio-waveform", () => ({ default: () => null }));

const request = {
	projectId: "project",
	trackId: "track",
	elementId: "clip",
	engine: "onnx" as const,
};
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

function sceneResult({
	engine = "onnx",
	timestamps = [0, 4, 8],
}: {
	engine?: "onnx" | "ffmpeg";
	timestamps?: number[];
} = {}): SceneDetectionResult {
	return {
		engine,
		route: `${engine}-route`,
		durationSeconds: 12,
		scenes: timestamps.map((timestamp) => ({ timestamp, confidence: 0.9 })),
		totalScenes: timestamps.length,
		averageShotDuration: 4,
	};
}

function readTrack() {
	return useTimelineStore
		.getState()
		._tracks.find((track) => track.id === "track");
}

function mutateSource({ updates }: { updates: Partial<MediaElement> }) {
	const tracks = useTimelineStore.getState()._tracks.map((track) => ({
		...track,
		elements: track.elements.map((element) =>
			element.id === "clip" && element.type === "media"
				? { ...element, ...updates }
				: element
		),
	}));
	useTimelineStore.setState({ _tracks: tracks, tracks });
}

function currentTask() {
	const task = useCloudTaskStore.getState().tasks[0];
	if (!task) throw new Error("Expected a scene detection task");
	return task;
}

function deferDetection() {
	let resolve!: (result: SceneDetectionResult) => void;
	let reject!: (error: Error) => void;
	mocks.scenes.mockReturnValueOnce(
		new Promise<SceneDetectionResult>((resolveResult, rejectResult) => {
			resolve = resolveResult;
			reject = rejectResult;
		})
	);
	return { resolve, reject };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	clearAllCloudTaskRuntimeActions();
	useCloudTaskStore.getState().resetTasks();
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
		fps: 24,
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
	mocks.scenes.mockReset().mockResolvedValue(sceneResult());
});

afterEach(() => {
	clearAllCloudTaskRuntimeActions();
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("editor scene engine routing", () => {
	it("applies ONNX cuts using the real split store, one history entry, and engine metadata", async () => {
		await runTimelineSmartShotSplit(request);
		expect(mocks.scenes).toHaveBeenCalledWith("project", {
			mediaId: "media",
			engine: "onnx",
			aiAnalysis: false,
		});
		expect(readTrack()?.elements.map((element) => element.startTime)).toEqual([
			10, 12, 16,
		]);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(currentTask()).toMatchObject({
			status: "completed",
			payload: { engine: "onnx", projectId: "project" },
			output: {
				engine: "onnx",
				route: "onnx-route",
				createdElementIds: [expect.any(String), expect.any(String)],
			},
		});
		useTimelineStore.getState().undo();
		expect(readTrack()?.elements).toEqual([source]);
	});

	it("defaults to FFmpeg with its existing threshold", async () => {
		mocks.scenes.mockResolvedValueOnce(sceneResult({ engine: "ffmpeg" }));
		await runTimelineSmartShotSplit({ ...request, engine: undefined });
		expect(mocks.scenes).toHaveBeenCalledWith("project", {
			mediaId: "media",
			engine: "ffmpeg",
			threshold: 0.3,
			aiAnalysis: false,
		});
		expect(currentTask().output?.engine).toBe("ffmpeg");
	});

	it("maps trimmed variable-speed source cuts into timeline coordinates", async () => {
		mutateSource({ updates: { playbackRate: 2 } });
		await runTimelineSmartShotSplit(request);
		expect(readTrack()?.elements.map((element) => element.startTime)).toEqual([
			10, 11, 13,
		]);
	});

	it("does not add history for a no-cut result", async () => {
		mocks.scenes.mockResolvedValueOnce(sceneResult({ timestamps: [0, 1, 11] }));
		await runTimelineSmartShotSplit(request);
		expect(readTrack()?.elements).toEqual([source]);
		expect(useTimelineStore.getState().history).toHaveLength(0);
		expect(currentTask().output).toMatchObject({
			engine: "onnx",
			createdElementIds: [],
		});
	});

	it("fails visibly without a fallback call or timeline changes", async () => {
		mocks.scenes.mockRejectedValueOnce(new Error("ONNX unavailable"));
		await runTimelineSmartShotSplit(request);
		expect(mocks.scenes).toHaveBeenCalledTimes(1);
		expect(currentTask()).toMatchObject({
			status: "failed",
			error: "ONNX unavailable",
		});
		expect(readTrack()?.elements).toEqual([source]);
	});

	it("rejects a backend silently returning the wrong engine", async () => {
		mocks.scenes.mockResolvedValueOnce(sceneResult({ engine: "ffmpeg" }));
		await runTimelineSmartShotSplit(request);
		expect(currentTask().status).toBe("failed");
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("preserves ONNX across a failed-task retry", async () => {
		mocks.scenes.mockRejectedValueOnce(new Error("temporarily unavailable"));
		await runTimelineSmartShotSplit(request);
		const { id } = currentTask();
		const pending = deferDetection();
		getCloudTaskRuntimeActions({ taskId: id })?.retry?.();
		expect(mocks.scenes).toHaveBeenLastCalledWith("project", {
			mediaId: "media",
			engine: "onnx",
			aiAnalysis: false,
		});
		pending.resolve(sceneResult());
		await vi.advanceTimersByTimeAsync(0);
		expect(currentTask()).toMatchObject({
			id,
			status: "completed",
			payload: { engine: "onnx" },
			output: { engine: "onnx" },
		});
	});

	it("suppresses a canceled result and leaves history untouched", async () => {
		const pending = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		getCloudTaskRuntimeActions({ taskId: currentTask().id })?.cancel?.();
		pending.resolve(sceneResult());
		await completion;
		expect(currentTask().status).toBe("canceled");
		expect(readTrack()?.elements).toEqual([source]);
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("does not let an old canceled attempt overwrite a successful retry", async () => {
		const old = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		getCloudTaskRuntimeActions({ taskId: currentTask().id })?.cancel?.();
		await runTimelineSmartShotSplit({
			...request,
			existingTaskId: currentTask().id,
		});
		old.resolve(sceneResult({ timestamps: [0, 3, 5, 9] }));
		await completion;
		expect(currentTask().status).toBe("completed");
		expect(readTrack()?.elements).toHaveLength(3);
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});
});

describe("pending scene-result snapshot guard", () => {
	it.each([
		{ startTime: 11 },
		{ duration: 14 },
		{ trimStart: 3 },
		{ trimEnd: 3 },
		{ playbackRate: 2 },
		{ reverse: true },
		{ mediaId: "replacement" },
	] satisfies Partial<MediaElement>[])("refuses a changed clip %j", async (updates) => {
		const pending = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		mutateSource({ updates });
		const changed = structuredClone(readTrack());
		pending.resolve(sceneResult());
		await completion;
		expect(currentTask().status).toBe("failed");
		expect(currentTask().error).toContain("changed during detection");
		expect(readTrack()).toEqual(changed);
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("latches a move even when the clip is moved back before inference returns", async () => {
		const pending = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		mutateSource({ updates: { startTime: 20 } });
		mutateSource({ updates: { startTime: 10 } });
		pending.resolve(sceneResult());
		await completion;
		expect(currentTask().status).toBe("failed");
		expect(readTrack()?.elements).toEqual([source]);
	});

	it.each([
		"delete",
		"move-track",
		"lock-track",
		"project",
		"scene",
		"fps",
		"loading",
		"relink",
		"replace-file",
		"remove-media",
	])("rejects %s while inference runs", async (change) => {
		const pending = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		const track = readTrack();
		const project = useProjectStore.getState().activeProject;
		if (!track || !project) throw new Error("Fixture missing");
		switch (change) {
			case "delete":
				useTimelineStore.setState({ _tracks: [{ ...track, elements: [] }] });
				break;
			case "move-track":
				useTimelineStore.setState({ _tracks: [{ ...track, id: "elsewhere" }] });
				break;
			case "lock-track":
				useTimelineStore.setState({ _tracks: [{ ...track, locked: true }] });
				break;
			case "project":
				useProjectStore.setState({
					activeProject: { ...project, id: "other" },
				});
				break;
			case "scene":
				useProjectStore.setState({
					activeProject: { ...project, currentSceneId: "other" },
				});
				break;
			case "fps":
				useProjectStore.setState({ activeProject: { ...project, fps: 60 } });
				break;
			case "loading":
				useProjectStore.setState({ isLoading: true });
				break;
			case "relink":
				useMediaStore.setState({
					mediaItems: useMediaStore
						.getState()
						.mediaItems.map((item) => ({ ...item, localPath: "/other.mp4" })),
				});
				break;
			case "replace-file":
				useMediaStore.setState({
					mediaItems: useMediaStore
						.getState()
						.mediaItems.map((item) => ({
							...item,
							file: new File(["other"], "source.mp4"),
						})),
				});
				break;
			case "remove-media":
				useMediaStore.setState({ mediaItems: [] });
				break;
		}
		const changed = structuredClone(useTimelineStore.getState()._tracks);
		pending.resolve(sceneResult());
		await completion;
		expect(currentTask().status).toBe("failed");
		expect(useTimelineStore.getState()._tracks).toEqual(changed);
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("permits selection and playhead-independent state changes", async () => {
		const pending = deferDetection();
		const completion = runTimelineSmartShotSplit(request);
		useTimelineStore.getState().selectElement("track", "clip");
		pending.resolve(sceneResult());
		await completion;
		expect(currentTask().status).toBe("completed");
	});
});

describe("scene task undo", () => {
	it("restores the source clip and keeps engine metadata", async () => {
		await runTimelineSmartShotSplit(request);
		getCloudTaskRuntimeActions({ taskId: currentTask().id })?.undo?.();
		expect(readTrack()?.elements).toEqual([source]);
		expect(currentTask().output).toMatchObject({
			engine: "onnx",
			undone: true,
		});
	});

	it.each([
		"project",
		"clip",
		"track",
	])("does not overwrite a later %s change", async (change) => {
		await runTimelineSmartShotSplit(request);
		const undo = getCloudTaskRuntimeActions({ taskId: currentTask().id })?.undo;
		if (change === "clip") mutateSource({ updates: { startTime: 50 } });
		if (change === "track") useTimelineStore.setState({ _tracks: [] });
		if (change === "project") useProjectStore.setState({ activeProject: null });
		const changed = structuredClone(useTimelineStore.getState()._tracks);
		undo?.();
		expect(useTimelineStore.getState()._tracks).toEqual(changed);
		expect(currentTask().output?.undone).toBeUndefined();
		expect(mocks.error).toHaveBeenCalledWith(
			expect.stringContaining("Timeline changed")
		);
	});
});
