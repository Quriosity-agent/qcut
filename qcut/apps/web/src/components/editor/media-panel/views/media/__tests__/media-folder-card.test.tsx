import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFolder } from "@/stores/media/media-store-types";

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

import { MediaFolderCard } from "../media-folder-card";

function folder(overrides: Partial<MediaFolder> = {}): MediaFolder {
	return {
		id: "clips",
		name: "clips",
		parentId: null,
		isExpanded: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("MediaFolderCard", () => {
	it("opens the folder on click and names it for assistive tech", () => {
		const onOpen = vi.fn();
		render(
			<MediaFolderCard folder={folder()} viewMode="grid" onOpen={onOpen} />
		);
		const card = screen.getByTestId("media-folder-card");
		expect(card).toHaveAttribute("data-folder-id", "clips");
		expect(card).toHaveAccessibleName(/clips/);
		expect(screen.getByTestId("media-item-name")).toHaveTextContent("clips");
		fireEvent.click(card);
		expect(onOpen).toHaveBeenCalledWith("clips");
	});

	it("tints the glyph with the folder colour", () => {
		render(
			<MediaFolderCard
				folder={folder({ color: "#ef4444" })}
				viewMode="list"
				onOpen={vi.fn()}
			/>
		);
		const glyph = screen.getByTestId("media-folder-card").firstElementChild;
		const body = glyph?.lastElementChild as HTMLElement;
		expect(body.style.backgroundColor).toBe("rgb(239, 68, 68)");
	});
});
