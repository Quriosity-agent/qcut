import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The editor's own Replace (clip context menu) put a sound in place of a
 * picture clip, which the editor API's replace-media refuses (PR #529
 * follow-up). Both now take the same rule: video and stills swap, a sound
 * stays a sound.
 */

const media = vi.hoisted(() => ({
	items: [
		{ id: "shot", name: "05_拳域_01.mp4", type: "video" },
		{ id: "score", name: "score.wav", type: "audio" },
	],
	addMediaItem: vi.fn(async () => "new-media"),
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: {
		getState: () => ({
			mediaItems: media.items,
			addMediaItem: media.addMediaItem,
		}),
	},
	getMediaAspectRatio: vi.fn(() => 16 / 9),
}));
vi.mock("@/stores/media/media-store-loader", () => ({
	getMediaStoreUtils: async () => ({
		getFileType: (file: File) =>
			file.type.startsWith("audio/")
				? "audio"
				: file.type.startsWith("image/")
					? "image"
					: "video",
		getImageDimensions: vi.fn(async () => ({ width: 10, height: 10 })),
		generateVideoThumbnail: vi.fn(async () => ({
			thumbnailUrl: "",
			width: 10,
			height: 10,
		})),
		getMediaDuration: vi.fn(async () => 10),
	}),
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({ activeProject: { id: "p1", fps: 24 } }),
	},
}));
vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveTimeline: vi.fn(() => Promise.resolve()),
		loadTimeline: vi.fn(() => Promise.resolve(null)),
	},
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { mediaKindMismatch } from "@/lib/media/media-replace-kind";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";

function setClip(mediaId: string) {
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "主轨道",
			type: "media",
			isMain: true,
			elements: [
				{
					id: "clip",
					type: "media",
					name: "clip",
					mediaId,
					startTime: 0,
					duration: 10,
					trimStart: 0,
					trimEnd: 0,
				},
			],
		},
	];
	useTimelineStore.setState({ _tracks: tracks, tracks, history: [] });
}

beforeEach(() => {
	media.addMediaItem.mockClear();
});

describe("what can replace a clip's media", () => {
	it("lets video and stills swap, and keeps a sound a sound", () => {
		expect(
			mediaKindMismatch({ current: "video", next: "image", nextName: "a.png" })
		).toBeUndefined();
		expect(
			mediaKindMismatch({ current: "audio", next: "audio", nextName: "b.wav" })
		).toBeUndefined();
		expect(
			mediaKindMismatch({ current: "image", next: "audio", nextName: "b.wav" })
		).toBe(
			"b.wav is audio; this clip's media is a picture, so it takes video or an image"
		);
	});

	it("refuses a sound for a picture clip in the editor's own Replace", async () => {
		setClip("shot");
		const file = new File(["x"], "score.mp3", { type: "audio/mpeg" });
		await expect(
			useTimelineStore.getState().replaceElementMedia("main", "clip", file)
		).resolves.toEqual({
			success: false,
			error:
				"score.mp3 is audio; this clip's media is a picture, so it takes video or an image",
		});
		// Refused before anything was imported.
		expect(media.addMediaItem).not.toHaveBeenCalled();
	});

	it("refuses a picture for a sound clip", async () => {
		setClip("score");
		const file = new File(["x"], "still.png", { type: "image/png" });
		const result = await useTimelineStore
			.getState()
			.replaceElementMedia("main", "clip", file);
		expect(result).toEqual({
			success: false,
			error:
				"still.png is a picture; this clip's media is audio, so it takes audio",
		});
	});
});
