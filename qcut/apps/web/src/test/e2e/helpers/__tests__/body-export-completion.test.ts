// @vitest-environment node
import { stat } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitForBodyExportFile } from "../body-export-completion";

vi.mock("node:fs/promises", () => ({ stat: vi.fn() }));

function pageProbe({ error = null }: { error?: string | null } = {}) {
	const evaluate = vi.fn(async () => error);
	const isClosed = vi.fn(() => false);
	return {
		page: { evaluate, isClosed } as unknown as Page,
		evaluate,
		isClosed,
	};
}

describe("body export completion", () => {
	beforeEach(() => {
		vi.mocked(stat).mockReset();
		vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));
	});

	it("rejects a real export failure before waiting for a missing output", async () => {
		const { page } = pageProbe({
			error: "OutOfFrameLandmarks: normalized points outside frame",
		});
		await expect(
			waitForBodyExportFile({ page, file: "/missing.mp4", timeout: 60_000 })
		).rejects.toThrow(
			"Body export failed: OutOfFrameLandmarks: normalized points outside frame"
		);
		expect(stat).not.toHaveBeenCalled();
	});

	it("does not accept a large partial file after the export failed", async () => {
		const { page } = pageProbe({ error: "Encoder failed" });
		vi.mocked(stat).mockResolvedValue({ size: 5_000 } as Awaited<
			ReturnType<typeof stat>
		>);
		await expect(
			waitForBodyExportFile({ page, file: "/partial.mp4", timeout: 60_000 })
		).rejects.toThrow("Body export failed: Encoder failed");
		expect(stat).not.toHaveBeenCalled();
	});

	it("accepts the original file-size threshold after checking for errors", async () => {
		const { page, evaluate } = pageProbe();
		vi.mocked(stat).mockResolvedValue({ size: 1_001 } as Awaited<
			ReturnType<typeof stat>
		>);
		await waitForBodyExportFile({
			page,
			file: "/complete.mp4",
			timeout: 1_000,
		});
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(stat).toHaveBeenCalledWith("/complete.mp4");
	});

	it("keeps waiting while rendering, then reports an error from a later poll", async () => {
		const { page, evaluate } = pageProbe();
		evaluate.mockResolvedValueOnce(null).mockResolvedValue("Worker exited");
		await expect(
			waitForBodyExportFile({ page, file: "/pending.mp4", timeout: 5_000 })
		).rejects.toThrow("Body export failed: Worker exited");
		expect(stat).toHaveBeenCalledTimes(1);
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it("fails immediately if the editor page has closed", async () => {
		const { page, evaluate, isClosed } = pageProbe();
		isClosed.mockReturnValue(true);
		await expect(
			waitForBodyExportFile({ page, file: "/missing.mp4", timeout: 60_000 })
		).rejects.toThrow("Editor page closed before export completed");
		expect(evaluate).not.toHaveBeenCalled();
		expect(stat).not.toHaveBeenCalled();
	});
});
