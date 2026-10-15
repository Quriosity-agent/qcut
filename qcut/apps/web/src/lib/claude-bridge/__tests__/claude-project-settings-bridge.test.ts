import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => {
	const state: {
		callback?: (projectId: string, settings: Record<string, unknown>) => void;
	} = {};
	return {
		state,
		updateSettings: vi.fn(async () => undefined),
		onUpdated: vi.fn(
			(
				callback: (projectId: string, settings: Record<string, unknown>) => void
			) => {
				state.callback = callback;
			}
		),
	};
});

const storage = vi.hoisted(() => ({
	loadProject: vi.fn(),
	saveProject: vi.fn(async () => {}),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		claude: {
			project: {
				onUpdated: projectApi.onUpdated,
				updateSettings: projectApi.updateSettings,
			},
		},
	}),
}));

vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));

import {
	applyClaudeProjectSettings,
	cleanupClaudeProjectSettingsBridge,
	setupClaudeProjectSettingsBridge,
} from "../claude-project-settings-bridge";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useProjectStore } from "@/stores/project-store";
import type { TProject } from "@/types/project";

const originalActions = {
	saveCurrentProject: useProjectStore.getState().saveCurrentProject,
	loadAllProjects: useProjectStore.getState().loadAllProjects,
};

function createProject({ id = "p1" }: { id?: string } = {}): TProject {
	const now = new Date();
	return {
		id,
		name: "Landscape",
		thumbnail: "",
		createdAt: now,
		updatedAt: now,
		scenes: [],
		currentSceneId: "",
		backgroundColor: "#000000",
		backgroundType: "color",
		blurIntensity: 8,
		bookmarks: [],
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		canvasMode: "preset",
	};
}

const SQUARE = { width: 1920, height: 1920, aspectRatio: "1:1" };

describe("Claude project settings bridge", () => {
	const saveCurrentProject = vi.fn(async () => {});
	const loadAllProjects = vi.fn(async () => {});

	beforeEach(() => {
		vi.clearAllMocks();
		projectApi.state.callback = undefined;
		useProjectStore.setState({
			activeProject: null,
			loadedProjectId: null,
			saveCurrentProject,
			loadAllProjects,
		});
		useEditorStore.setState({
			canvasSize: { width: 1920, height: 1080 },
			canvasMode: "preset",
		});
	});

	afterEach(() => {
		cleanupClaudeProjectSettingsBridge();
		useProjectStore.setState({
			activeProject: null,
			loadedProjectId: null,
			...originalActions,
		});
	});

	it("applies an update to the loaded project live and saves it", async () => {
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});

		await applyClaudeProjectSettings({ projectId: "p1", settings: SQUARE });

		expect(useProjectStore.getState().activeProject?.canvasSize).toEqual({
			width: 1920,
			height: 1920,
		});
		expect(useEditorStore.getState().canvasSize).toEqual({
			width: 1920,
			height: 1920,
		});
		expect(saveCurrentProject).toHaveBeenCalledOnce();
		expect(storage.saveProject).not.toHaveBeenCalled();
	});

	it("writes an update for a closed project into its stored record", async () => {
		storage.loadProject.mockResolvedValueOnce(createProject());

		await applyClaudeProjectSettings({ projectId: "p1", settings: SQUARE });

		expect(storage.saveProject).toHaveBeenCalledWith({
			project: expect.objectContaining({
				id: "p1",
				canvasSize: { width: 1920, height: 1920 },
				canvasMode: "custom",
			}),
		});
		expect(loadAllProjects).toHaveBeenCalledOnce();
		expect(saveCurrentProject).not.toHaveBeenCalled();
	});

	it("re-applies an update that raced a load once the project has loaded", async () => {
		// The load read the record before the update was written.
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: null,
		});
		storage.loadProject.mockResolvedValueOnce(createProject());
		setupClaudeProjectSettingsBridge();

		await applyClaudeProjectSettings({ projectId: "p1", settings: SQUARE });
		expect(saveCurrentProject).not.toHaveBeenCalled();

		useProjectStore.setState({ loadedProjectId: "p1" });

		await vi.waitFor(() => expect(saveCurrentProject).toHaveBeenCalledOnce());
		expect(useProjectStore.getState().activeProject?.canvasSize).toEqual({
			width: 1920,
			height: 1920,
		});
	});

	it("ignores a project that does not exist", async () => {
		storage.loadProject.mockResolvedValueOnce(null);

		await applyClaudeProjectSettings({
			projectId: "missing",
			settings: SQUARE,
		});

		expect(storage.saveProject).not.toHaveBeenCalled();
		expect(loadAllProjects).not.toHaveBeenCalled();
	});

	it("handles updates delivered over IPC", async () => {
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});
		setupClaudeProjectSettingsBridge();

		projectApi.state.callback?.("p1", { fps: 60 });

		await vi.waitFor(() => expect(saveCurrentProject).toHaveBeenCalledOnce());
		expect(useProjectStore.getState().activeProject?.fps).toBe(60);
	});

	it("mirrors canvas, frame rate and background changes into project.qcut", async () => {
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});
		setupClaudeProjectSettingsBridge();

		// The first clip fitting the canvas, or the canvas picker.
		useProjectStore.setState({
			activeProject: {
				...createProject(),
				canvasSize: { width: 1280, height: 720 },
				canvasMode: "custom",
				fps: 24,
			},
		});

		expect(projectApi.updateSettings).toHaveBeenLastCalledWith(
			"p1",
			{ width: 1280, height: 720, fps: 24, backgroundColor: "#000000" },
			{ broadcast: false }
		);
	});

	it("does not rewrite unchanged settings", () => {
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});
		setupClaudeProjectSettingsBridge();
		useProjectStore.setState({ isLoading: false });
		const calls = projectApi.updateSettings.mock.calls.length;

		useProjectStore.setState({ isLoading: true });
		useProjectStore.setState({ isLoading: false });

		expect(projectApi.updateSettings.mock.calls.length).toBe(calls);
	});

	it("does not mirror a project that is still loading", () => {
		setupClaudeProjectSettingsBridge();
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: null,
		});

		expect(projectApi.updateSettings).not.toHaveBeenCalled();
	});

	it("retries a mirror write that failed", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		projectApi.updateSettings.mockRejectedValueOnce(new Error("disk full"));
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});
		setupClaudeProjectSettingsBridge();

		useProjectStore.setState({
			activeProject: { ...createProject(), fps: 24 },
		});
		expect(projectApi.updateSettings).toHaveBeenCalledOnce();
		await vi.waitFor(() =>
			expect(consoleError).toHaveBeenCalledWith(
				"[ClaudeProjectSettingsBridge] Mirror failed:",
				expect.any(Error)
			)
		);

		// Any later store change tries the same settings again.
		useProjectStore.setState({ isLoading: false });
		expect(projectApi.updateSettings).toHaveBeenCalledTimes(2);
		expect(projectApi.updateSettings).toHaveBeenLastCalledWith(
			"p1",
			expect.objectContaining({ fps: 24 }),
			{ broadcast: false }
		);
	});

	it("writes one state at a time and finishes on the newest", async () => {
		let finishFirst: () => void = () => {};
		projectApi.updateSettings.mockImplementationOnce(
			() =>
				new Promise<undefined>((resolve) => {
					finishFirst = () => resolve(undefined);
				})
		);
		useProjectStore.setState({
			activeProject: createProject(),
			loadedProjectId: "p1",
		});
		setupClaudeProjectSettingsBridge();

		for (const fps of [24, 25, 50]) {
			useProjectStore.setState({
				activeProject: { ...createProject(), fps },
			});
		}
		// Only the first write is in flight; the rest wait for it.
		expect(projectApi.updateSettings).toHaveBeenCalledOnce();

		finishFirst();
		await vi.waitFor(() =>
			expect(projectApi.updateSettings).toHaveBeenCalledTimes(2)
		);
		expect(projectApi.updateSettings).toHaveBeenLastCalledWith(
			"p1",
			expect.objectContaining({ fps: 50 }),
			{ broadcast: false }
		);
	});
});
