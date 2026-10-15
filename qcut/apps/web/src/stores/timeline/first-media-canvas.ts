import {
	ErrorCategory,
	ErrorSeverity,
	handleError,
} from "@/lib/debug/error-handler";

/**
 * Fits the canvas to the first clip placed on an empty timeline, but only
 * while the project still has its untouched preset canvas. A size someone
 * chose (in the canvas picker, or through `editor:project:update-settings`)
 * is kept: a 1280×720 project must not snap to the 1920×1080 preset because
 * a 16:9 clip arrived.
 *
 * The frame rate is left alone. Imported videos carry a 30 fps placeholder,
 * not their real rate, so copying it would overwrite a rate someone set.
 */
export async function fitCanvasToFirstMedia({
	mediaId,
}: {
	mediaId: string;
}): Promise<void> {
	try {
		const [mediaModule, { useEditorStore }, { useProjectStore }] =
			await Promise.all([
				import("../media/media-store"),
				import("../editor/editor-store"),
				import("../project-store"),
			]);
		const project = useProjectStore.getState().activeProject;
		if (!project || project.canvasMode !== "preset") return;

		const mediaItem = mediaModule.useMediaStore
			.getState()
			.mediaItems.find((item) => item.id === mediaId);
		if (
			!mediaItem ||
			(mediaItem.type !== "image" && mediaItem.type !== "video")
		)
			return;

		useEditorStore
			.getState()
			.setCanvasSizeFromAspectRatio(mediaModule.getMediaAspectRatio(mediaItem));
		await useProjectStore
			.getState()
			.updateProjectCanvasSize(useEditorStore.getState().canvasSize, "custom");
	} catch (error) {
		handleError(error, {
			operation: "Set canvas size from first element",
			category: ErrorCategory.STORAGE,
			severity: ErrorSeverity.LOW,
			showToast: false,
		});
	}
}
