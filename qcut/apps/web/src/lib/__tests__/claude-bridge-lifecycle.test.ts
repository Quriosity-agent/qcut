import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	cleanupClaudeProjectBridge,
	cleanupClaudeTimelineBridge,
	setupClaudeProjectBridge,
	setupClaudeTimelineBridge,
} from "@/lib/claude-timeline-bridge";
import { setupClaudeBridgeLifecycle } from "@/lib/claude-bridge-lifecycle";

vi.mock("@/lib/claude-timeline-bridge", () => ({
	setupClaudeTimelineBridge: vi.fn(),
	setupClaudeProjectBridge: vi.fn(),
	cleanupClaudeTimelineBridge: vi.fn(),
	cleanupClaudeProjectBridge: vi.fn(),
}));

describe("setupClaudeBridgeLifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets up and cleans up both bridges", () => {
		const cleanup = setupClaudeBridgeLifecycle();

		expect(setupClaudeTimelineBridge).toHaveBeenCalledTimes(1);
		expect(setupClaudeProjectBridge).toHaveBeenCalledTimes(1);

		cleanup();

		expect(cleanupClaudeTimelineBridge).toHaveBeenCalledTimes(1);
		expect(cleanupClaudeProjectBridge).toHaveBeenCalledTimes(1);
	});

	it("continues setup when timeline bridge setup throws", () => {
		const setupError = new Error("timeline setup failed");
		vi.mocked(setupClaudeTimelineBridge).mockImplementationOnce(() => {
			throw setupError;
		});
		const onError = vi.fn();

		const cleanup = setupClaudeBridgeLifecycle({ onError });

		expect(setupClaudeProjectBridge).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			"[ClaudeBridge] Failed to setup timeline bridge",
			setupError
		);

		cleanup();
	});

	it("continues cleanup when timeline bridge cleanup throws", () => {
		const cleanupError = new Error("timeline cleanup failed");
		vi.mocked(cleanupClaudeTimelineBridge).mockImplementationOnce(() => {
			throw cleanupError;
		});
		const onError = vi.fn();

		const cleanup = setupClaudeBridgeLifecycle({ onError });
		cleanup();

		expect(cleanupClaudeProjectBridge).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			"[ClaudeBridge] Failed to cleanup timeline bridge",
			cleanupError
		);
	});
});
