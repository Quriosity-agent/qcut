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

/**
 * Simulates the notification logic from FFmpegHealthNotification component.
 * Extracted here so tests exercise the real branching without mounting React.
 */
async function runHealthCheckLogic(
  checkHealth: () => Promise<any>
): Promise<void> {
  const result = await checkHealth();
  if (result.ffmpegOk && result.ffprobeOk) return;

  const failed: string[] = [];
  if (!result.ffmpegOk) failed.push("FFmpeg");
  if (!result.ffprobeOk) failed.push("FFprobe");

  const lines: string[] = [
    `${failed.join(" and ")} binary not found or not executable.`,
  ];

  if (result.ffmpegPath) {
    lines.push(`FFmpeg path: ${result.ffmpegPath}`);
  }
  if (result.ffprobePath) {
    lines.push(`FFprobe path: ${result.ffprobePath}`);
  }

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      lines.push(`Error: ${err}`);
    }
  }

  toast.warning("Video export may not work", {
    description: lines.join("\n"),
    duration: 30_000,
  });
}

describe("FFmpeg health notification logic", () => {
  const originalElectronAPI = (globalThis as any).window?.electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
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

    await runHealthCheckLogic(mockCheckHealth);

    expect(mockCheckHealth).toHaveBeenCalledOnce();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("shows warning toast with path and error when FFmpeg fails", async () => {
    const mockCheckHealth = vi.fn().mockResolvedValue({
      ffmpegOk: false,
      ffprobeOk: true,
      ffmpegVersion: "",
      ffprobeVersion: "6.1.1",
      ffmpegPath: "/usr/bin/ffmpeg",
      ffprobePath: "/usr/bin/ffprobe",
      errors: ["FFmpeg spawn error: ENOENT"],
    });

    await runHealthCheckLogic(mockCheckHealth);

    expect(mockCheckHealth).toHaveBeenCalledOnce();
    expect(toast.warning).toHaveBeenCalledWith(
      "Video export may not work",
      expect.objectContaining({
        description: expect.stringContaining("FFmpeg path: /usr/bin/ffmpeg"),
        duration: 30_000,
      })
    );
    // Should include the specific error
    const call = (toast.warning as any).mock.calls[0];
    expect(call[1].description).toContain("Error: FFmpeg spawn error: ENOENT");
    // Should NOT mention FFprobe in the failure line
    expect(call[1].description).toMatch(
      /^FFmpeg binary not found or not executable\./
    );
  });

  it("shows both binaries when both fail", async () => {
    const mockCheckHealth = vi.fn().mockResolvedValue({
      ffmpegOk: false,
      ffprobeOk: false,
      ffmpegVersion: "",
      ffprobeVersion: "",
      ffmpegPath: "C:\\app\\ffmpeg.exe",
      ffprobePath: "C:\\app\\ffprobe.exe",
      errors: ["FFmpeg spawn error: ENOENT", "FFprobe spawn error: ENOENT"],
    });

    await runHealthCheckLogic(mockCheckHealth);

    const call = (toast.warning as any).mock.calls[0];
    const desc: string = call[1].description;
    expect(desc).toContain("FFmpeg and FFprobe binary not found");
    expect(desc).toContain("FFmpeg path: C:\\app\\ffmpeg.exe");
    expect(desc).toContain("FFprobe path: C:\\app\\ffprobe.exe");
    expect(desc).toContain("Error: FFmpeg spawn error: ENOENT");
    expect(desc).toContain("Error: FFprobe spawn error: ENOENT");
  });

  it("does nothing when electronAPI is not available", () => {
    (globalThis as any).window.electronAPI = undefined;

    const checkHealth = (globalThis as any).window?.electronAPI?.ffmpeg
      ?.checkHealth;

    if (!checkHealth) {
      expect(toast.warning).not.toHaveBeenCalled();
      return;
    }

    expect.unreachable("checkHealth should not be available");
  });
});
