import { describe, it, expect, vi } from "vitest";
import { mapEditStatusToProgress, sleep } from "../image-edit-polling";

describe("image-edit-polling", () => {
	describe("mapEditStatusToProgress", () => {
		it("maps IN_QUEUE to queued with progress 10", () => {
			const result = mapEditStatusToProgress(
				{ status: "IN_QUEUE", queue_position: 3 },
				5
			);
			expect(result.status).toBe("queued");
			expect(result.progress).toBe(10);
			expect(result.message).toContain("3");
			expect(result.elapsedTime).toBe(5);
		});

		it("maps IN_PROGRESS to processing with dynamic progress", () => {
			const result = mapEditStatusToProgress({ status: "IN_PROGRESS" }, 10);
			expect(result.status).toBe("processing");
			// progress = min(90, 20 + 10*3) = min(90, 50) = 50
			expect(result.progress).toBe(50);
			expect(result.message).toBe("Processing image...");
		});

		it("caps IN_PROGRESS progress at 90", () => {
			const result = mapEditStatusToProgress({ status: "IN_PROGRESS" }, 100);
			// progress = min(90, 20 + 100*3) = min(90, 320) = 90
			expect(result.progress).toBe(90);
		});

		it("maps COMPLETED to 100", () => {
			const result = mapEditStatusToProgress({ status: "COMPLETED" }, 15);
			expect(result.status).toBe("completed");
			expect(result.progress).toBe(100);
		});

		it("maps FAILED to 0", () => {
			const result = mapEditStatusToProgress(
				{ status: "FAILED", error: "Something went wrong" },
				8
			);
			expect(result.status).toBe("failed");
			expect(result.progress).toBe(0);
			expect(result.message).toBe("Something went wrong");
		});

		it("maps unknown status to processing with progress 5", () => {
			const result = mapEditStatusToProgress({ status: "UNKNOWN_STATUS" }, 2);
			expect(result.status).toBe("processing");
			expect(result.progress).toBe(5);
			expect(result.message).toContain("UNKNOWN_STATUS");
		});
	});

	describe("sleep", () => {
		it("resolves after specified duration", async () => {
			vi.useFakeTimers();
			const promise = sleep(1000);
			vi.advanceTimersByTime(1000);
			await expect(promise).resolves.toBeUndefined();
			vi.useRealTimers();
		});
	});
});
