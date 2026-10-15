import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../../editor/editor-api-client.js";
import { buildProjectJSON } from "../project-json-builder.js";

function createClient({
	media,
}: {
	media: Array<Record<string, unknown>>;
}): EditorApiClient {
	return {
		get: vi.fn(async (requestPath: string) => {
			if (requestPath.endsWith("/settings")) return { name: "Door plan" };
			if (requestPath.endsWith("/stats")) return {};
			if (requestPath.includes("/media/")) return media;
			if (requestPath.endsWith("/navigator/projects")) {
				return { activeProjectId: "project-1", projects: [] };
			}
			throw new Error(`Unexpected path: ${requestPath}`);
		}),
	} as unknown as EditorApiClient;
}

describe("project.json media fields", () => {
	it("reads size from the media API's nested dimensions", async () => {
		const project = await buildProjectJSON(
			createClient({
				media: [
					{
						id: "clip-7",
						type: "video",
						name: "clip-7.mp4",
						path: "/project/media/clip-7.mp4",
						duration: 16.041667,
						dimensions: { width: 1280, height: 720 },
						fps: 24,
					},
				],
			}),
			"project-1"
		);

		expect(project.media[0]).toMatchObject({
			duration: 16.041667,
			width: 1280,
			height: 720,
			fps: 24,
		});
	});

	it("still reads flat width and height", async () => {
		const project = await buildProjectJSON(
			createClient({
				media: [
					{
						id: "still",
						type: "image",
						name: "still.png",
						path: "/project/media/still.png",
						width: 640,
						height: 480,
					},
				],
			}),
			"project-1"
		);

		expect(project.media[0]).toMatchObject({
			width: 640,
			height: 480,
			duration: null,
			fps: null,
		});
	});
});
