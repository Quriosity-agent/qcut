/**
 * Verifies packaged staged FFmpeg binaries.
 *
 * Contract:
 * - resources/ffmpeg/<platform>-<arch>/ffmpeg(.exe)
 * - resources/ffmpeg/<platform>-<arch>/ffprobe(.exe)
 *
 * The script checks all staged targets and runs `-version` on the host target
 * when a runnable binary is available on the current OS/arch.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

interface CandidateDir {
  fullPath: string;
  mtimeMs: number;
}

interface RunBinaryResult {
  exitCode: number | null;
  firstLine: string;
  stderr: string;
  error: string;
}

interface StageTarget {
  platform: string;
  arch: string;
  key: string;
}

const DEFAULT_STAGE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "linux-x64",
];
const VERSION_TIMEOUT_MS = 8000;

function getErrorMessage({ error }: { error: unknown }): string {
  try {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  } catch {
    return "Unknown error";
  }
}

function parseTargets({ rawTargets }: { rawTargets: string }): StageTarget[] {
  try {
    const uniqueKeys = new Set(
      rawTargets
        .split(",")
        .map((target) => target.trim())
        .filter(Boolean)
    );

    if (uniqueKeys.size === 0) {
      throw new Error("No staged FFmpeg targets configured");
    }

    return Array.from(uniqueKeys).map((key) => {
      const [platform, arch] = key.split("-");
      if (!platform || !arch) {
        throw new Error(
          `Invalid staged target "${key}". Expected format "<platform>-<arch>".`
        );
      }
      return { platform, arch, key };
    });
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse staged targets: ${getErrorMessage({ error })}`
    );
  }
}

function getBinaryName({
  target,
  tool,
}: {
  target: StageTarget;
  tool: "ffmpeg" | "ffprobe";
}): string {
  try {
    if (target.platform === "win32") {
      return `${tool}.exe`;
    }
    return tool;
  } catch (error: unknown) {
    throw new Error(
      `Failed to resolve binary name: ${getErrorMessage({ error })}`
    );
  }
}

async function resolveLatestResourcesDir(): Promise<string> {
  try {
    const distDir = join(process.cwd(), "dist-electron");
    if (!existsSync(distDir)) {
      throw new Error(`dist-electron not found: ${distDir}`);
    }

    const entries = await readdir(distDir, { withFileTypes: true });
    const candidateGroups = await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        if (!entry.isDirectory()) {
          return [];
        }

        const entryPath = join(distDir, entry.name);
        if (entry.name.endsWith("win-unpacked")) {
          return [join(entryPath, "resources")];
        }
        if (entry.name.endsWith("linux-unpacked")) {
          return [join(entryPath, "resources")];
        }

        const macBundleCandidates = await readdir(entryPath, {
          withFileTypes: true,
        }).catch(() => []);

        return macBundleCandidates
          .filter((macEntry) => macEntry.isDirectory())
          .filter((macEntry) => macEntry.name.endsWith(".app"))
          .map((macEntry) =>
            join(entryPath, macEntry.name, "Contents", "Resources")
          );
      })
    );
    const candidateResourcesDirs = candidateGroups.flat();

    const existingCandidates = candidateResourcesDirs.filter((dirPath) =>
      existsSync(dirPath)
    );
    if (existingCandidates.length === 0) {
      throw new Error(`No packaged resources directory found in: ${distDir}`);
    }

    const candidates: CandidateDir[] = await Promise.all(
      existingCandidates.map(async (fullPath): Promise<CandidateDir> => {
        const fileStat = await stat(fullPath);
        return { fullPath, mtimeMs: fileStat.mtimeMs };
      })
    );

    const newest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return newest.fullPath;
  } catch (error: unknown) {
    throw new Error(
      `Failed to resolve packaged resources directory: ${getErrorMessage({ error })}`
    );
  }
}

function isRunnableOnHost({ target }: { target: StageTarget }): boolean {
  try {
    return target.platform === process.platform && target.arch === process.arch;
  } catch {
    return false;
  }
}

function runBinaryVersion({
  binaryPath,
  timeoutMs,
}: {
  binaryPath: string;
  timeoutMs: number;
}): Promise<RunBinaryResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(binaryPath, ["-version"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const timeoutId = setTimeout(() => {
        proc.kill();
        resolve({
          exitCode: null,
          firstLine: "",
          stderr,
          error: `timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (exitCode: number | null) => {
        clearTimeout(timeoutId);
        const firstLine = (stdout.split(/\r?\n/)[0] ?? "").trim();
        resolve({ exitCode, firstLine, stderr, error: "" });
      });

      proc.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: null,
          firstLine: "",
          stderr,
          error: error.message,
        });
      });
    } catch (error: unknown) {
      resolve({
        exitCode: null,
        firstLine: "",
        stderr: "",
        error: getErrorMessage({ error }),
      });
    }
  });
}

async function verifyPackagedFFmpeg(): Promise<void> {
  try {
    const resourcesDir = await resolveLatestResourcesDir();
    const stagedRoot = join(resourcesDir, "ffmpeg");
    if (!existsSync(stagedRoot)) {
      throw new Error(
        `Packaged staged FFmpeg directory not found: ${stagedRoot}`
      );
    }

    const rawTargets =
      process.env.FFMPEG_STAGE_TARGETS || DEFAULT_STAGE_TARGETS.join(",");
    const targets = parseTargets({ rawTargets });

    const missingPaths: string[] = [];
    for (const target of targets) {
      const ffmpegPath = join(
        stagedRoot,
        target.key,
        getBinaryName({ target, tool: "ffmpeg" })
      );
      const ffprobePath = join(
        stagedRoot,
        target.key,
        getBinaryName({ target, tool: "ffprobe" })
      );

      if (!existsSync(ffmpegPath)) {
        missingPaths.push(ffmpegPath);
      }
      if (!existsSync(ffprobePath)) {
        missingPaths.push(ffprobePath);
      }
    }

    if (missingPaths.length > 0) {
      throw new Error(
        `Missing staged binaries in packaged app:\n${missingPaths.join("\n")}`
      );
    }

    const runnableTarget = targets.find((target) =>
      isRunnableOnHost({ target })
    );
    if (!runnableTarget) {
      process.stdout.write(
        `✅ Packaged FFmpeg verification passed (presence only). No runnable host target in: ${targets.map((target) => target.key).join(", ")}\n`
      );
      return;
    }

    const ffmpegPath = join(
      stagedRoot,
      runnableTarget.key,
      getBinaryName({ target: runnableTarget, tool: "ffmpeg" })
    );
    const ffprobePath = join(
      stagedRoot,
      runnableTarget.key,
      getBinaryName({ target: runnableTarget, tool: "ffprobe" })
    );

    const [ffmpegResult, ffprobeResult] = await Promise.all([
      runBinaryVersion({
        binaryPath: ffmpegPath,
        timeoutMs: VERSION_TIMEOUT_MS,
      }),
      runBinaryVersion({
        binaryPath: ffprobePath,
        timeoutMs: VERSION_TIMEOUT_MS,
      }),
    ]);

    if (ffmpegResult.error || ffmpegResult.exitCode !== 0) {
      throw new Error(
        `ffmpeg failed for ${runnableTarget.key} (exit=${ffmpegResult.exitCode}, error=${ffmpegResult.error}, stderr=${ffmpegResult.stderr.trim()})`
      );
    }
    if (ffprobeResult.error || ffprobeResult.exitCode !== 0) {
      throw new Error(
        `ffprobe failed for ${runnableTarget.key} (exit=${ffprobeResult.exitCode}, error=${ffprobeResult.error}, stderr=${ffprobeResult.stderr.trim()})`
      );
    }

    process.stdout.write("✅ Packaged FFmpeg verification passed\n");
    process.stdout.write(`Resources dir: ${resourcesDir}\n`);
    process.stdout.write(`FFmpeg: ${ffmpegPath}\n`);
    process.stdout.write(`FFprobe: ${ffprobePath}\n`);
    process.stdout.write(`FFmpeg version: ${ffmpegResult.firstLine}\n`);
    process.stdout.write(`FFprobe version: ${ffprobeResult.firstLine}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `❌ Packaged FFmpeg verification failed: ${getErrorMessage({ error })}\n`
    );
    process.exit(1);
  }
}

verifyPackagedFFmpeg();
