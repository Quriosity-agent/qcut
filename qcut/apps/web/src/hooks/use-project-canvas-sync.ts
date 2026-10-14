import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useProjectStore } from "@/stores/project-store";

/**
 * Keeps the editor canvas in step with the active project's canvas size and
 * mode while the editor shows `projectId`. Settings updates from the editor
 * API reach the project store through the Claude project settings bridge.
 */
export function useProjectCanvasSync({
	projectId,
}: {
	projectId: string;
}): void {
	useEffect(() => {
		if (!projectId) {
			return;
		}

		const activeProject = useProjectStore.getState().activeProject;
		if (activeProject?.id === projectId) {
			useEditorStore
				.getState()
				.setCanvasSize(activeProject.canvasSize, activeProject.canvasMode);
		}

		return useProjectStore.subscribe((state, previousState) => {
			const project = state.activeProject;
			if (project?.id !== projectId) return;

			const previousProject = previousState.activeProject;
			if (
				previousProject?.id !== projectId ||
				previousProject.canvasSize.width !== project.canvasSize.width ||
				previousProject.canvasSize.height !== project.canvasSize.height ||
				previousProject.canvasMode !== project.canvasMode
			) {
				useEditorStore
					.getState()
					.setCanvasSize(project.canvasSize, project.canvasMode);
			}
		});
	}, [projectId]);
}
