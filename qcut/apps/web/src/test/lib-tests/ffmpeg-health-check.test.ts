import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SPAWN_TIMEOUT = 15_000;
const STAGED_TARGETS = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"];

function getBinaryName({ tool }: { tool: "ffmpeg" | "ffprobe" }): string {
  if (process.platform === "win32") {
    return `${tool}.exe`;
  }
  return tool;
}

function resolveStagedBinaryPath({
  tool,
}: {
  tool: "ffmpeg" | "ffprobe";
}): string | null {
  try {
    const binaryName = getBinaryName({ tool });
    const targetKeys = Array.from(
      new Set([
        `${process.platform}-${process.arch}`,
        ...STAGED_TARGETS.filter((target) =>
          target.startsWith(`${process.platform}-`)
        ),
      ])
    );

    for (const targetKey of targetKeys) {
      const candidate = join(
        __dirname,
        "../../../../../electron/resources/ffmpeg",
        targetKey,
        binaryName
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function resolveFallbackBinaryPath({
  tool,
}: {
  tool: "ffmpeg" | "ffprobe";
}): string | null {
  try {
    if (tool === "ffmpeg") {
      const ffmpegPath: string = require("ffmpeg-static");
      if (existsSync(ffmpegPath) && isExecutable({ binaryPath: ffmpegPath })) {
        return ffmpegPath;
      }
      return null;
    }

    const ffprobePath: string = require("ffprobe-static").path;
    if (existsSync(ffprobePath) && isExecutable({ binaryPath: ffprobePath })) {
      return ffprobePath;
    }
    return null;
  } catch {
    return null;
  }
}

function isExecutable({ binaryPath }: { binaryPath: string }): boolean {
  try {
    const result = spawnSync(binaryPath, ["-version"], {
      timeout: 2_500,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveBinaryPath({
  tool,
}: {
  tool: "ffmpeg" | "ffprobe";
}): string | null {
  const stagedPath = resolveStagedBinaryPath({ tool });
  if (stagedPath) {
    return stagedPath;
  }
  return resolveFallbackBinaryPath({ tool });
}

function spawnVersion({
  binaryPath,
}: {
  binaryPath: string;
}): Promise<{ code: number | null; stdout: string; error: string }> {
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

      proc.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        resolve({ code: null, stdout: "", error: error.message });
      });
    } catch (error: unknown) {
      resolve({
        code: null,
        stdout: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

describe("FFmpeg binary health check", () => {
  const ffmpegPath = resolveBinaryPath({ tool: "ffmpeg" });
  const ffprobePath = resolveBinaryPath({ tool: "ffprobe" });

  const runFFmpegTest = ffmpegPath ? it : it.skip;
  const runFFprobeTest = ffprobePath ? it : it.skip;
  const runCombinedTest = ffmpegPath && ffprobePath ? it : it.skip;

  runFFmpegTest(
    "ffmpeg -version returns exit code 0",
    async () => {
      const result = await spawnVersion({ binaryPath: ffmpegPath as string });
      expect(result.error).toBe("");
      expect(result.code).toBe(0);
    },
    SPAWN_TIMEOUT + 1000
  );

  runFFmpegTest(
    "ffmpeg version string is parseable",
    async () => {
      const result = await spawnVersion({ binaryPath: ffmpegPath as string });
      const firstLine = result.stdout.split("\n")[0] ?? "";
      expect(firstLine).toMatch(/ffmpeg version \d+\.\d+/);
    },
    SPAWN_TIMEOUT + 1000
  );

  runFFprobeTest(
    "ffprobe -version returns exit code 0",
    async () => {
      const result = await spawnVersion({ binaryPath: ffprobePath as string });
      expect(result.error).toBe("");
      expect(result.code).toBe(0);
    },
    SPAWN_TIMEOUT + 1000
  );

  runFFprobeTest(
    "ffprobe version string is parseable",
    async () => {
      const result = await spawnVersion({ binaryPath: ffprobePath as string });
      const firstLine = result.stdout.split("\n")[0] ?? "";
      expect(firstLine).toMatch(/ffprobe version \d+\.\d+/);
    },
    SPAWN_TIMEOUT + 1000
  );

  runCombinedTest(
    "both binaries respond within 15 seconds",
    async () => {
      const start = Date.now();
      await Promise.all([
        spawnVersion({ binaryPath: ffmpegPath as string }),
        spawnVersion({ binaryPath: ffprobePath as string }),
      ]);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(SPAWN_TIMEOUT);
    },
    SPAWN_TIMEOUT + 1000
  );
});
