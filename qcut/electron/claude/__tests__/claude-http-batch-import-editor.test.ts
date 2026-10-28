/**
 * N15 (2026-10-28 trailer report): right after a batch import, the second
 * add-element timed out and its element was not placed, because the editor
 * only loaded the imported files on the first add. A batch import now waits
 * for the editor to load what it copied.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchImportResult } from "../../types/claude-api.js";
import { loadBatchImportInEditor } from "../http/claude-http-batch-import-editor.js";

function copied(index: number, name: string): BatchImportResult {
	return {
		index,
		success: true,
		mediaFile: {
			id: `media_${name}`,
			name,
			path: `/projects/p/media/imported/${name}`,
			type: "video",
			size: 1000 + index,
			createdAt: 0,
			modifiedAt: 0,
		},
	};
}

describe("batch import loads the copied files in the editor", () => {
	afterEach(() => vi.useRealTimers());

	it("waits for each file in order and marks it ready", async () => {
		const order: string[] = [];
		const requestMediaImport = vi.fn(async ({ name }: { name: string }) => {
			order.push(name);
		});
		const results = await loadBatchImportInEditor({
			accessor: { requestMediaImport },
			projectId: "p",
			results: [
				copied(0, "sub01.mov"),
				{ index: 1, success: false, error: "File not found" },
				copied(2, "sub02.mov"),
			],
		});

		expect(order).toEqual(["sub01.mov", "sub02.mov"]);
		expect(requestMediaImport).toHaveBeenCalledWith({
			id: "media_sub01.mov",
			name: "sub01.mov",
			path: "/projects/p/media/imported/sub01.mov",
			projectId: "p",
			size: 1000,
			type: "video",
		});
		expect(results.map((result) => result.editorReady)).toEqual([
			true,
			undefined,
			true,
		]);
		expect(results[1]).toEqual({
			index: 1,
			success: false,
			error: "File not found",
		});
	});

	it("names what the editor could not load", async () => {
		const results = await loadBatchImportInEditor({
			accessor: {
				requestMediaImport: vi
					.fn()
					.mockRejectedValue(new Error("Imported media could not be read")),
			},
			projectId: "p",
			results: [copied(0, "sub01.mov")],
		});

		expect(results[0]).toMatchObject({ success: true, editorReady: false });
		expect(results[0].warning).toContain("Imported media could not be read");
	});

	it("stops waiting after its budget but still sends the rest", async () => {
		vi.useFakeTimers();
		const pending: Array<() => void> = [];
		const requestMediaImport = vi.fn(
			() => new Promise<void>((resolve) => pending.push(resolve))
		);
		const loading = loadBatchImportInEditor({
			accessor: { requestMediaImport },
			projectId: "p",
			results: [copied(0, "sub01.mov"), copied(1, "sub02.mov")],
			waitMs: 1000,
		});
		await vi.advanceTimersByTimeAsync(1000);
		const results = await loading;

		// The second file was still handed to the editor to load.
		expect(requestMediaImport).toHaveBeenCalledTimes(2);
		expect(results.map((result) => result.editorReady)).toEqual([false, false]);
		expect(results[0].warning).toContain("still loading");
		for (const resolve of pending) resolve();
	});

	it("leaves the results alone without an editor to ask", async () => {
		const results = [copied(0, "sub01.mov")];
		await expect(
			loadBatchImportInEditor({ accessor: {}, projectId: "p", results })
		).resolves.toBe(results);
	});
});
