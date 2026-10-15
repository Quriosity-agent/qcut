import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import type { TProject } from "@/types/project";
import { handleError } from "@/lib/debug/error-handler";
import { fitCanvasToFirstMedia } from "../first-media-canvas";

vi.mock("@/lib/debug/error-handler", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/debug/error-handler")>()),
	handleError: vi.fn(),
}));

function project(canvasMode: TProject["canvasMode"]): TProject {
	return {
		id: "project-1",
		name: "Door plan",
		thumbnail: "",
		createdAt: new Date(),
		updatedAt: new Date(),
		fps: 24,
		canvasSize: { width: 1280, height: 720 },
		canvasMode,
	} as TProject;
}

const updateProjectCanvasSize = vi.fn(async () => undefined);
const updateProjectFps = vi.fn(async () => undefined);

describe("fitCanvasToFirstMedia", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useMediaStore.setState({
			mediaItems: [
				{
					id: "portrait-clip",
					name: "portrait.mp4",
					type: "video",
					width: 1080,
					height: 1920,
					fps: 30,
				},
			] as never,
		});
		useProjectStore.setState({ updateProjectCanvasSize, updateProjectFps });
	});

	it("fits an untouched preset canvas to the first clip", async () => {
		useProjectStore.setState({ activeProject: project("preset") });
		await fitCanvasToFirstMedia({ mediaId: "portrait-clip" });

		expect(updateProjectCanvasSize).toHaveBeenCalledWith(
			useEditorStore.getState().canvasSize,
			"custom"
		);
		const { width, height } = useEditorStore.getState().canvasSize;
		expect(height).toBeGreaterThan(width);
	});

	it("keeps a canvas size someone chose", async () => {
		useProjectStore.setState({ activeProject: project("custom") });
		await fitCanvasToFirstMedia({ mediaId: "portrait-clip" });

		expect(updateProjectCanvasSize).not.toHaveBeenCalled();
	});

	it("never copies the clip's placeholder frame rate", async () => {
		useProjectStore.setState({ activeProject: project("preset") });
		await fitCanvasToFirstMedia({ mediaId: "portrait-clip" });

		expect(updateProjectFps).not.toHaveBeenCalled();
	});

	it("leaves the canvas alone for a clip without a picture", async () => {
		useMediaStore.setState({
			mediaItems: [{ id: "song", name: "song.mp3", type: "audio" }] as never,
		});
		useProjectStore.setState({ activeProject: project("preset") });
		await fitCanvasToFirstMedia({ mediaId: "song" });

		expect(updateProjectCanvasSize).not.toHaveBeenCalled();
	});

	it("reports a failed save instead of throwing", async () => {
		updateProjectCanvasSize.mockRejectedValueOnce(new Error("quota exceeded"));
		useProjectStore.setState({ activeProject: project("preset") });

		await expect(
			fitCanvasToFirstMedia({ mediaId: "portrait-clip" })
		).resolves.toBeUndefined();
		expect(handleError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "quota exceeded" }),
			expect.objectContaining({
				operation: "Set canvas size from first element",
			})
		);
	});
});
