import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { importManifestMedia } from "../native-pipeline/editor/editor-timeline-apply-media.js";

/** An editor that takes at most 20 files per import, as the real one does. */
function editor({
	failAt,
	dropRequest,
}: {
	failAt?: string;
	/** The 1-based import request that never gets an answer. */
	dropRequest?: number;
} = {}) {
	const batches: string[][] = [];
	const post = vi.fn(
		async (
			_url: string,
			body: { items: Array<{ path: string }> },
			_options?: { timeout?: number }
		) => {
			if (body.items.length > 20) {
				throw new Error(
					`Batch size ${body.items.length} exceeds maximum of 20`
				);
			}
			if (batches.length + 1 === dropRequest) {
				throw new Error("socket hang up");
			}
			batches.push(body.items.map((item) => item.path));
			return body.items.map((item) =>
				item.path === failAt
					? { success: false, error: "unreadable" }
					: { success: true, mediaFile: { id: `id:${item.path}` } }
			);
		}
	);
	const client = {
		get: vi.fn(async () => []),
		post,
	} as unknown as EditorApiClient;
	return { client, post, batches };
}

const media = ({ count }: { count: number }) =>
	Array.from({ length: count }, (_, index) => ({
		alias: `clip-${index}`,
		path: `/no/such/dir/clip-${index}.mp4`,
	}));

describe("timeline apply: importing a manifest's media", () => {
	/** Found replaying the 2026-11-14 manifest: 157 new files failed as one batch. */
	it("imports more files than one request takes, in order", async () => {
		const { client, post, batches } = editor();
		const mediaIds = new Map<string, string>();
		const newMediaIds = new Set<string>();
		await importManifestMedia({
			client,
			projectId: "project-1",
			media: media({ count: 45 }),
			mediaIds,
			newMediaIds,
		});
		expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5]);
		expect(batches.flat()).toEqual(
			media({ count: 45 }).map((entry) => entry.path)
		);
		expect(mediaIds.get("clip-0")).toBe("id:/no/such/dir/clip-0.mp4");
		expect(mediaIds.get("clip-44")).toBe("id:/no/such/dir/clip-44.mp4");
		expect(newMediaIds.size).toBe(45);
		// Each request waits long enough for the editor to load its files.
		expect(post.mock.calls[0][2]?.timeout).toBeGreaterThanOrEqual(60_000);
	});

	it("names the file that failed, wherever its batch was", async () => {
		const { client } = editor({ failAt: "/no/such/dir/clip-31.mp4" });
		await expect(
			importManifestMedia({
				client,
				projectId: "project-1",
				media: media({ count: 45 }),
				mediaIds: new Map(),
				newMediaIds: new Set(),
			})
		).rejects.toThrow("Media 'clip-31' failed: unreadable");
	});

	it("remembers the files already imported when a later request fails", async () => {
		const { client } = editor({ dropRequest: 2 });
		const newMediaIds = new Set<string>();
		await expect(
			importManifestMedia({
				client,
				projectId: "project-1",
				media: media({ count: 25 }),
				mediaIds: new Map(),
				newMediaIds,
			})
		).rejects.toThrow("socket hang up");
		// The caller can take the first 20 back out.
		expect(newMediaIds.size).toBe(20);
		expect(newMediaIds.has("id:/no/such/dir/clip-19.mp4")).toBe(true);
	});

	it("remembers every file of a batch that also holds a failed one", async () => {
		const { client } = editor({ failAt: "/no/such/dir/clip-3.mp4" });
		const newMediaIds = new Set<string>();
		await expect(
			importManifestMedia({
				client,
				projectId: "project-1",
				media: media({ count: 6 }),
				mediaIds: new Map(),
				newMediaIds,
			})
		).rejects.toThrow("Media 'clip-3' failed: unreadable");
		expect([...newMediaIds].sort()).toEqual(
			[0, 1, 2, 4, 5].map((index) => `id:/no/such/dir/clip-${index}.mp4`)
		);
	});
});
