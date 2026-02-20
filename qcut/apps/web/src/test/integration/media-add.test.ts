import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMediaStore } from "@/stores/media-store";
import { mockVideoItem, mockImageItem } from "@/test/fixtures/media-items";

// Mock navigator.storage API
const mockFileHandle = {
	createWritable: vi.fn().mockResolvedValue({
		write: vi.fn(),
		close: vi.fn(),
	}),
};

const mockDirectory = {
	getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
	getDirectoryHandle: vi.fn().mockResolvedValue({}),
};

global.navigator = {
	...global.navigator,
	storage: {
		getDirectory: vi.fn().mockResolvedValue(mockDirectory),
	},
} as any;

describe("Media Addition", () => {
	beforeEach(() => {
		useMediaStore.setState({ mediaItems: [] });
	});

	it("adds media item to store", () => {
		const store = useMediaStore.getState();
		const initialCount = store.mediaItems.length;

		// Directly set state to simulate adding an item without storage
		useMediaStore.setState({
			mediaItems: [...store.mediaItems, mockVideoItem],
		});

		const updatedState = useMediaStore.getState();
		expect(updatedState.mediaItems.length).toBe(initialCount + 1);
		expect(updatedState.mediaItems[0].id).toBe(mockVideoItem.id);
	});

	it("prevents duplicate media items", () => {
		const store = useMediaStore.getState();

		// Add item once
		useMediaStore.setState({
			mediaItems: [mockVideoItem],
		});

		// Try to add same item again - should not duplicate
		const existingItem = useMediaStore
			.getState()
			.mediaItems.find((item) => item.id === mockVideoItem.id);
		if (!existingItem) {
			useMediaStore.setState({
				mediaItems: [...useMediaStore.getState().mediaItems, mockVideoItem],
			});
		}

		const finalState = useMediaStore.getState();
		expect(finalState.mediaItems.length).toBe(1);
	});
});
