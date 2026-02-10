import { describe, it, expect } from "vitest";
import { spawn } from "child_process";

/**
 * Tests for FFmpeg binary health check — verifies that ffmpeg-static and
 * ffprobe-static binaries are not only present on disk, but actually
 * executable and return valid version information.
 *
 * These tests complement ffmpeg-path-resolution.test.ts (which checks
 * paths and packaging config) by validating runtime behavior.
 */

/** Timeout for each spawn (ms) */
const SPAWN_TIMEOUT = 5000;

/**
 * Spawns a binary with -version and returns { code, stdout, error }.
 */
function spawnVersion(
  binaryPath: string
): Promise<{ code: number | null; stdout: string; error: string }> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(binaryPath, ["-version"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        proc.kill();
        resolve({ code: null, stdout: "", error: "timed out" });
      }, SPAWN_TIMEOUT);

      let stdout = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        resolve({ code, stdout, error: "" });
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        resolve({ code: null, stdout: "", error: err.message });
      });
    } catch (err: any) {
      resolve({ code: null, stdout: "", error: err.message });
    }
  });
}

describe("FFmpeg binary health check", () => {
  describe("ffmpeg execution", () => {
    const ffmpegPath: string = require("ffmpeg-static");

    it(
      "ffmpeg -version returns exit code 0",
      async () => {
        const result = await spawnVersion(ffmpegPath);
        expect(result.error).toBe("");
        expect(result.code).toBe(0);
      },
      SPAWN_TIMEOUT + 1000,
    );

    it(
      "ffmpeg version string is parseable",
      async () => {
        const result = await spawnVersion(ffmpegPath);
        const firstLine = result.stdout.split("\n")[0] ?? "";
        expect(firstLine).toMatch(/ffmpeg version \d+\.\d+/);
      },
      SPAWN_TIMEOUT + 1000,
    );
  });

  describe("ffprobe execution", () => {
    const ffprobePath: string = require("ffprobe-static").path;

    it(
      "ffprobe -version returns exit code 0",
      async () => {
        const result = await spawnVersion(ffprobePath);
        expect(result.error).toBe("");
        expect(result.code).toBe(0);
      },
      SPAWN_TIMEOUT + 1000,
    );

    it(
      "ffprobe version string is parseable",
      async () => {
        const result = await spawnVersion(ffprobePath);
        const firstLine = result.stdout.split("\n")[0] ?? "";
        expect(firstLine).toMatch(/ffprobe version \d+\.\d+/);
      },
      SPAWN_TIMEOUT + 1000,
    );
  });

  it(
    "both binaries respond within 5 seconds",
    async () => {
      const ffmpegPath: string = require("ffmpeg-static");
      const ffprobePath: string = require("ffprobe-static").path;

      const start = Date.now();
      await Promise.all([spawnVersion(ffmpegPath), spawnVersion(ffprobePath)]);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(SPAWN_TIMEOUT);
    },
    SPAWN_TIMEOUT + 1000
  );
});
