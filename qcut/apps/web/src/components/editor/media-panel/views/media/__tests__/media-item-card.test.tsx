import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ shell: undefined }),
}));
vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: Object.assign(vi.fn(), {
		getState: () => ({ addMediaAtTime: vi.fn() }),
	}),
}));
vi.mock("@/lib/stickers/add-media-overlay", () => ({
	addMediaItemAsOverlay: vi.fn(),
}));
vi.mock("@/stores/editor/playback-store", () => ({
	usePlaybackStore: (selector: (state: { currentTime: number }) => unknown) =>
		selector({ currentTime: 0 }),
}));
vi.mock("@/components/editor/audio-waveform", () => ({
	default: () => <div data-testid="mock-waveform" />,
}));
vi.mock("@/lib/filmstrip/filmstrip-extractor", () => ({
	extractFrames: vi.fn(async () => new Map()),
}));

import { MediaItemCard } from "../media-item-card";

function video(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: "v1",
		name: "25_Shot21_一部手机.mp4",
		type: "video",
		duration: 16,
		thumbnailUrl: "data:image/png;base64,AAAA",
		thumbnailStatus: "ready",
		file: new File(["v"], "25_Shot21_一部手机.mp4", { type: "video/mp4" }),
		...overrides,
	};
}

function renderCard({
	item = video(),
	viewMode = "grid",
	usageCount = 0,
}: {
	item?: MediaItem;
	viewMode?: "grid" | "list";
	usageCount?: number;
} = {}) {
	return render(
		<MediaItemCard
			item={item}
			isSelected={false}
			filteredMediaItems={[item]}
			folders={[]}
			addToFolder={undefined}
			removeFromFolder={undefined}
			onToggleSelect={vi.fn()}
			onEdit={vi.fn()}
			onRemove={vi.fn()}
			viewMode={viewMode}
			usageCount={usageCount}
		/>
	);
}

describe("MediaItemCard", () => {
	it("draws the duration over the thumbnail and keeps the file name tail", () => {
		renderCard();
		expect(screen.getByTestId("media-item-duration")).toHaveTextContent(
			"00:16"
		);
		const name = screen.getByTestId("media-item-name");
		expect(name).toHaveAttribute("title", "25_Shot21_一部手机.mp4");
		expect(name.lastElementChild).toHaveTextContent("一部手机.mp4");
		expect(screen.queryByTestId("media-item-added-badge")).toBeNull();
		expect(screen.getByRole("img")).toHaveAttribute(
			"src",
			"data:image/png;base64,AAAA"
		);
	});

	it("shows an added badge once the media is on the timeline, with the count past one", () => {
		renderCard({ usageCount: 1 });
		expect(
			screen.getByTestId("media-item-added-badge").textContent
		).not.toMatch(/×/);
	});

	it("appends the usage count when the media is placed more than once", () => {
		renderCard({ usageCount: 3 });
		expect(screen.getByTestId("media-item-added-badge")).toHaveTextContent(
			"×3"
		);
	});

	it("renders a full-width strip instead of the thumbnail in list view", () => {
		renderCard({ viewMode: "list" });
		const strip = screen.getByTestId("media-strip-preview");
		expect(strip).toHaveAttribute("data-media-type", "video");
		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.getByTestId("media-item-duration")).toHaveTextContent(
			"00:16"
		);
	});

	it("uses the waveform for audio strips and skips the duration for items without one", () => {
		renderCard({
			viewMode: "list",
			item: video({
				id: "a1",
				name: "bgm.m4a",
				type: "audio",
				duration: undefined,
				thumbnailUrl: undefined,
			}),
		});
		expect(screen.getByTestId("mock-waveform")).toBeInTheDocument();
		expect(screen.queryByTestId("media-item-duration")).toBeNull();
	});
});
