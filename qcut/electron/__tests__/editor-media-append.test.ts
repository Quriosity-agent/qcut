import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { appendImportedMedia } from "../native-pipeline/editor/editor-media-append.js";
import type { BatchImportResult, MediaFile } from "../types/claude-api.js";

function imported({
	index,
	name,
	type,
}: {
	index: number;
	name: string;
	type: MediaFile["type"];
}): BatchImportResult {
	return {
		index,
		success: true,
		mediaFile: {
			id: `media-${index}`,
			name,
			type,
			path: `/project/media/${name}`,
			size: 1,
			createdAt: 0,
			modifiedAt: 0,
		},
	};
}

function fakeClient() {
	const post = vi.fn(async () => ({ added: [], failedCount: 0 }));
	return { client: { post } as unknown as EditorApiClient, post };
}

describe("appendImportedMedia", () => {
	it("appends imported video and audio to the track end, in import order", async () => {
		const { client, post } = fakeClient();
		const result = await appendImportedMedia({
			client,
			projectId: "project 1",
			trackId: "main",
			imported: [
				imported({ index: 0, name: "01.mp4", type: "video" }),
				{ index: 1, success: false, error: "File not found" },
				imported({ index: 2, name: "02.mp4", type: "video" }),
				imported({ index: 3, name: "cover.png", type: "image" }),
			],
		});

		expect(post).toHaveBeenCalledWith(
			"/api/claude/timeline/project%201/elements/batch",
			{
				elements: [
					{
						type: "media",
						trackId: "main",
						sourceId: "media-0",
						sourceName: "01.mp4",
						startTime: "end",
					},
					{
						type: "media",
						trackId: "main",
						sourceId: "media-2",
						sourceName: "02.mp4",
						startTime: "end",
					},
				],
			}
		);
		expect(result.skipped).toEqual([
			{
				index: 3,
				name: "cover.png",
				reason: "a still image has no length; add it with a duration",
			},
		]);
		expect(result.appended).toEqual({ added: [], failedCount: 0 });
	});

	it("adds nothing when nothing was imported", async () => {
		const { client, post } = fakeClient();
		const result = await appendImportedMedia({
			client,
			projectId: "project-1",
			trackId: "main",
			imported: [{ index: 0, success: false, error: "File not found" }],
		});
		expect(post).not.toHaveBeenCalled();
		expect(result.appended).toBeNull();
	});
});
