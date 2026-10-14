import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectCanvasSync } from "@/hooks/use-project-canvas-sync";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useProjectStore } from "@/stores/project-store";
import type { TProject } from "@/types/project";

function createProject({
	width = 1280,
	height = 720,
}: {
	width?: number;
	height?: number;
} = {}): TProject {
	const now = new Date();
	return {
		id: "project-1",
		name: "Aspect Test",
		thumbnail: "",
		createdAt: now,
		updatedAt: now,
		scenes: [
			{
				id: "scene-1",
				name: "Main Scene",
				isMain: true,
				createdAt: now,
				updatedAt: now,
			},
		],
		currentSceneId: "scene-1",
		backgroundColor: "#000000",
		backgroundType: "color",
		blurIntensity: 8,
		bookmarks: [],
		fps: 30,
		canvasSize: { width, height },
		canvasMode: "custom",
	};
}

describe("useProjectCanvasSync", () => {
	beforeEach(() => {
		useProjectStore.setState({ activeProject: null, loadedProjectId: null });
		useEditorStore.setState({
			canvasSize: { width: 1920, height: 1080 },
			canvasMode: "preset",
		});
	});

	it("restores the project canvas when the project loads", () => {
		const { unmount } = renderHook(() =>
			useProjectCanvasSync({ projectId: "project-1" })
		);

		act(() => {
			useProjectStore.setState({
				activeProject: createProject({ width: 1080, height: 1920 }),
			});
		});

		expect(useEditorStore.getState().canvasSize).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(useEditorStore.getState().canvasMode).toBe("custom");
		unmount();
	});

	it("follows later canvas changes of the active project", () => {
		useProjectStore.setState({ activeProject: createProject() });
		const { unmount } = renderHook(() =>
			useProjectCanvasSync({ projectId: "project-1" })
		);
		expect(useEditorStore.getState().canvasSize).toEqual({
			width: 1280,
			height: 720,
		});

		act(() => {
			useProjectStore.setState({
				activeProject: createProject({ width: 1080, height: 1080 }),
			});
		});

		expect(useEditorStore.getState().canvasSize).toEqual({
			width: 1080,
			height: 1080,
		});
		unmount();
	});
});
