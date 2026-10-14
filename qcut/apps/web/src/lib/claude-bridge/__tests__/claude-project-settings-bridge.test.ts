import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => {
	const state: {
		callback?: (projectId: string, settings: Record<string, unknown>) => void;
	} = {};
	return {
		state,
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
		claude: { project: { onUpdated: projectApi.onUpdated } },
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
});
