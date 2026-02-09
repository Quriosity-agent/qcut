import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

interface BinaryRunResult {
  exitCode: number | null;
  firstLine: string;
  stderr: string;
  error: string;
}

interface CandidateDir {
  fullPath: string;
  mtimeMs: number;
}

async function resolveWinUnpackedDir({
  distDir,
}: {
  distDir: string;
}): Promise<string> {
  try {
    const entries = await readdir(distDir, { withFileTypes: true });
    const candidateNames = entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith("win-unpacked"))
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
      (entry) => entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()
    );
    if (directHit) {
      return join(startDir, directHit.name);
    }

    const subDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(startDir, entry.name));
    const nestedHits = await Promise.all(
      subDirs.map(async (subDir): Promise<string | null> =>
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

async function verifyPackagedFFmpeg(): Promise<void> {
  try {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`❌ Packaged FFmpeg verification failed: ${message}\n`);
    process.exit(1);
  }
}

try {
  await verifyPackagedFFmpeg();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`❌ Unexpected verification failure: ${message}\n`);
  process.exit(1);
}
