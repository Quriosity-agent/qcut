/**
 * Post-build verification script for packaged FFmpeg binaries.
 *
 * Runs after electron-builder to confirm that ffmpeg.exe and ffprobe.exe
 * are present, correctly unpacked, and executable inside the win-unpacked
 * output directory. Exits with code 1 if any check fails.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Result of spawning a binary with `-version`. */
interface BinaryRunResult {
  exitCode: number | null;
  firstLine: string;
  stderr: string;
  error: string;
}

/** Directory candidate with modification time for sorting. */
interface CandidateDir {
  fullPath: string;
  mtimeMs: number;
}

/**
 * Finds the win-unpacked output directory inside dist-electron.
 * If multiple candidates exist, returns the most recently modified one.
 * @param distDir - The dist-electron directory path
 * @returns Absolute path to the win-unpacked directory
 */
async function resolveWinUnpackedDir({
  distDir,
}: {
  distDir: string;
}): Promise<string> {
  try {
    const entries = await readdir(distDir, { withFileTypes: true });
    const candidateNames = entries
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith("win-unpacked")
      )
      .map((entry) => entry.name);

    if (candidateNames.length === 0) {
      throw new Error(`No win-unpacked directory found in: ${distDir}`);
    }

    if (candidateNames.length === 1) {
      return join(distDir, candidateNames[0]);
    }

    const candidates: CandidateDir[] = await Promise.all(
      candidateNames.map(async (name): Promise<CandidateDir> => {
        const fullPath = join(distDir, name);
        const fileStat = await stat(fullPath);
        return { fullPath, mtimeMs: fileStat.mtimeMs };
      })
    );

    const newest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return newest.fullPath;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve win-unpacked directory: ${message}`);
  }
}

/**
 * Recursively searches for a file by name starting from the given directory.
 * @param startDir - Root directory to begin the search
 * @param fileName - Case-insensitive file name to find
 * @returns Absolute path to the first match, or null if not found
 */
async function findFirstFile({
  startDir,
  fileName,
}: {
  startDir: string;
  fileName: string;
}): Promise<string | null> {
  try {
    const entries = await readdir(startDir, { withFileTypes: true });
    const directHit = entries.find(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()
    );
    if (directHit) {
      return join(startDir, directHit.name);
    }

    const subDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(startDir, entry.name));
    const nestedHits = await Promise.all(
      subDirs.map(
        async (subDir): Promise<string | null> =>
          findFirstFile({ startDir: subDir, fileName })
      )
    );

    for (const hit of nestedHits) {
      if (hit) {
        return hit;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Locates a node_modules package inside the packaged app resources.
 * Checks app.asar.unpacked/node_modules first, then bare node_modules.
 * @param resourcesDir - The resources directory of the packaged app
 * @param moduleName - npm package name (e.g. "ffmpeg-static")
 * @returns Absolute path to the module directory, or null if not found
 */
function resolvePackagedModuleDir({
  resourcesDir,
  moduleName,
}: {
  resourcesDir: string;
  moduleName: string;
}): string | null {
  try {
    const candidateRoots = [
      join(resourcesDir, "app.asar.unpacked", "node_modules"),
      join(resourcesDir, "node_modules"),
    ];

    for (const root of candidateRoots) {
      const moduleDir = join(root, moduleName);
      if (existsSync(moduleDir)) {
        return moduleDir;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the binary path within a module directory.
 * For ffprobe, checks arch-specific subdirectories (preferred → x64 → ia32).
 * @param moduleDir - Root directory of the npm module
 * @param binaryName - Binary file name (e.g. "ffmpeg.exe")
 * @returns Absolute path to the binary, or null if not found
 */
function resolvePreferredBinaryPath({
  moduleDir,
  binaryName,
}: {
  moduleDir: string;
  binaryName: string;
}): string | null {
  try {
    const directPath = join(moduleDir, binaryName);
    if (existsSync(directPath)) {
      return directPath;
    }

    if (binaryName.toLowerCase() === "ffprobe.exe") {
      const preferredArch = process.arch === "ia32" ? "ia32" : "x64";
      const candidates = new Set([
        join(moduleDir, "bin", "win32", preferredArch, "ffprobe.exe"),
        join(moduleDir, "bin", "win32", "x64", "ffprobe.exe"),
        join(moduleDir, "bin", "win32", "ia32", "ffprobe.exe"),
      ]);
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Spawns a binary with `-version` and captures the output.
 * Returns a result object instead of throwing, for safe parallel execution.
 * @param binaryPath - Absolute path to the executable
 * @param timeoutMs - Maximum time to wait before killing the process
 * @returns Exit code, first stdout line, stderr, and any error message
 */
function runBinaryVersion({
  binaryPath,
  timeoutMs,
}: {
  binaryPath: string;
  timeoutMs: number;
}): Promise<BinaryRunResult> {
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
      const message = error instanceof Error ? error.message : String(error);
      resolve({ exitCode: null, firstLine: "", stderr: "", error: message });
    }
  });
}

/**
 * Main verification entry point. Locates the packaged win-unpacked directory,
 * finds ffmpeg.exe and ffprobe.exe, validates paths, and executes them to
 * confirm they are functional. Throws on any failure.
 */
async function verifyPackagedFFmpeg(): Promise<void> {
  const distDir = join(process.cwd(), "dist-electron");
  if (!existsSync(distDir)) {
    throw new Error(`dist-electron not found: ${distDir}`);
  }

  const winUnpackedDir = await resolveWinUnpackedDir({ distDir });
  const resourcesDir = join(winUnpackedDir, "resources");
  const ffmpegRoot = resolvePackagedModuleDir({
    resourcesDir,
    moduleName: "ffmpeg-static",
  });
  const ffprobeRoot = resolvePackagedModuleDir({
    resourcesDir,
    moduleName: "ffprobe-static",
  });

  if (!ffmpegRoot) {
    throw new Error(
      `ffmpeg-static not packaged under: ${join(resourcesDir, "app.asar.unpacked", "node_modules")} or ${join(resourcesDir, "node_modules")}`
    );
  }

  if (!ffprobeRoot) {
    throw new Error(
      `ffprobe-static not packaged under: ${join(resourcesDir, "app.asar.unpacked", "node_modules")} or ${join(resourcesDir, "node_modules")}`
    );
  }

  const ffmpegPath =
    resolvePreferredBinaryPath({
      moduleDir: ffmpegRoot,
      binaryName: "ffmpeg.exe",
    }) ??
    (await findFirstFile({
      startDir: ffmpegRoot,
      fileName: "ffmpeg.exe",
    }));
  const ffprobePath =
    resolvePreferredBinaryPath({
      moduleDir: ffprobeRoot,
      binaryName: "ffprobe.exe",
    }) ??
    (await findFirstFile({
      startDir: ffprobeRoot,
      fileName: "ffprobe.exe",
    }));

  if (!ffmpegPath) {
    throw new Error(`ffmpeg.exe not found under: ${ffmpegRoot}`);
  }

  if (!ffprobePath) {
    throw new Error(`ffprobe.exe not found under: ${ffprobeRoot}`);
  }

  if (ffmpegPath.includes("app.asar.unpacked.unpacked")) {
    throw new Error(`Invalid FFmpeg path rewrite detected: ${ffmpegPath}`);
  }

  if (ffprobePath.includes("app.asar.unpacked.unpacked")) {
    throw new Error(`Invalid FFprobe path rewrite detected: ${ffprobePath}`);
  }

  const [ffmpegResult, ffprobeResult] = await Promise.all([
    runBinaryVersion({ binaryPath: ffmpegPath, timeoutMs: 8000 }),
    runBinaryVersion({ binaryPath: ffprobePath, timeoutMs: 8000 }),
  ]);

  if (ffmpegResult.error || ffmpegResult.exitCode !== 0) {
    throw new Error(
      `ffmpeg.exe failed (exit=${ffmpegResult.exitCode}, error=${ffmpegResult.error}, stderr=${ffmpegResult.stderr.trim()})`
    );
  }

  if (ffprobeResult.error || ffprobeResult.exitCode !== 0) {
    throw new Error(
      `ffprobe.exe failed (exit=${ffprobeResult.exitCode}, error=${ffprobeResult.error}, stderr=${ffprobeResult.stderr.trim()})`
    );
  }

  process.stdout.write("✅ Packaged FFmpeg verification passed\n");
  process.stdout.write(`FFmpeg: ${ffmpegPath}\n`);
  process.stdout.write(`FFprobe: ${ffprobePath}\n`);
  process.stdout.write(`FFmpeg version: ${ffmpegResult.firstLine}\n`);
  process.stdout.write(`FFprobe version: ${ffprobeResult.firstLine}\n`);
}

try {
  await verifyPackagedFFmpeg();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`❌ Packaged FFmpeg verification failed: ${message}\n`);
  process.exit(1);
}
