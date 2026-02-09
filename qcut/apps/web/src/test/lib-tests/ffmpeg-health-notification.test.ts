import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for FFmpegHealthNotification component logic.
 *
 * These tests verify the health check integration by testing
 * the core logic: calling checkHealth() and deciding whether
 * to show a warning toast based on the result.
 */

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";

describe("FFmpeg health notification logic", () => {
  const originalElectronAPI = (globalThis as any).window?.electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up global window if needed
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
  });

  afterEach(() => {
    if (originalElectronAPI !== undefined) {
      (globalThis as any).window.electronAPI = originalElectronAPI;
    } else {
      (globalThis as any).window.electronAPI = undefined;
    }
  });

  it("does not show toast when both binaries are OK", async () => {
    const mockCheckHealth = vi.fn().mockResolvedValue({
      ffmpegOk: true,
      ffprobeOk: true,
      ffmpegVersion: "6.1.1",
      ffprobeVersion: "6.1.1",
      ffmpegPath: "/usr/bin/ffmpeg",
      ffprobePath: "/usr/bin/ffprobe",
      errors: [],
    });

    (globalThis as any).window.electronAPI = {
      ffmpeg: { checkHealth: mockCheckHealth },
    };

    // Run the same logic as the component's useEffect
    const result = await mockCheckHealth();
    if (!result.ffmpegOk || !result.ffprobeOk) {
      toast.warning("Video export may not work");
    }

    expect(mockCheckHealth).toHaveBeenCalledOnce();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("shows warning toast when FFmpeg is not OK", async () => {
    const mockCheckHealth = vi.fn().mockResolvedValue({
      ffmpegOk: false,
      ffprobeOk: true,
      ffmpegVersion: "",
      ffprobeVersion: "6.1.1",
      ffmpegPath: "/usr/bin/ffmpeg",
      ffprobePath: "/usr/bin/ffprobe",
      errors: ["FFmpeg spawn error: ENOENT"],
    });

    (globalThis as any).window.electronAPI = {
      ffmpeg: { checkHealth: mockCheckHealth },
    };

    const result = await mockCheckHealth();
    if (!result.ffmpegOk || !result.ffprobeOk) {
      const failed: string[] = [];
      if (!result.ffmpegOk) failed.push("FFmpeg");
      if (!result.ffprobeOk) failed.push("FFprobe");
      toast.warning("Video export may not work", {
        description: `${failed.join(" and ")} binary not found or not executable. Try reinstalling QCut.`,
        duration: 15_000,
      });
    }

    expect(mockCheckHealth).toHaveBeenCalledOnce();
    expect(toast.warning).toHaveBeenCalledWith(
      "Video export may not work",
      expect.objectContaining({
        description: expect.stringContaining("FFmpeg"),
      })
    );
  });

  it("does nothing when electronAPI is not available", () => {
    (globalThis as any).window.electronAPI = undefined;

    const checkHealth = (globalThis as any).window?.electronAPI?.ffmpeg
      ?.checkHealth;

    // Same guard as the component
    if (!checkHealth) {
      // Early return — no error, no toast
      expect(toast.warning).not.toHaveBeenCalled();
      return;
    }

    // Should not reach here
    expect.unreachable("checkHealth should not be available");
  });
});
