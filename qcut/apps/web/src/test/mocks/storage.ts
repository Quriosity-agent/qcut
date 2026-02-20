import { vi } from "vitest";

/**
 * Mock Storage Adapter matching lib/storage/storage-service.ts
 */
export class MockStorageAdapter {
	private storage = new Map<string, any>();

	get = vi.fn().mockImplementation(async (key: string) => {
		return this.storage.get(key) || null;
	});

	set = vi.fn().mockImplementation(async (key: string, value: any) => {
		this.storage.set(key, value);
	});

	delete = vi.fn().mockImplementation(async (key: string) => {
		this.storage.delete(key);
	});

	getAll = vi.fn().mockImplementation(async () => {
		return Array.from(this.storage.values());
	});

	clear = vi.fn().mockImplementation(async () => {
		this.storage.clear();
	});

	has = vi.fn().mockImplementation(async (key: string) => {
		return this.storage.has(key);
	});
}

/**
 * Mock for the complete storage service
 */
export const mockStorageService = {
	// Project operations
	saveProject: vi.fn().mockResolvedValue(undefined),
	loadProject: vi.fn().mockResolvedValue({ id: "test-project", name: "Test" }),
	deleteProject: vi.fn().mockResolvedValue(undefined),
	getAllProjects: vi.fn().mockResolvedValue([]),

	// Media operations
	saveMediaFile: vi.fn().mockResolvedValue("media-id"),
	loadMediaFile: vi.fn().mockResolvedValue(new Blob(["test"])),
	deleteMediaFile: vi.fn().mockResolvedValue(undefined),

	// Timeline operations
	saveTimeline: vi.fn().mockResolvedValue(undefined),
	loadTimeline: vi.fn().mockResolvedValue({ tracks: [] }),

	// Storage adapters
	projectsAdapter: new MockStorageAdapter(),
	mediaAdapter: new MockStorageAdapter(),
	timelineAdapter: new MockStorageAdapter(),
};
