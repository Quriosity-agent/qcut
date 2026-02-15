import * as fs from "fs";
import * as path from "path";

const OUTPUT_FILE_EXTENSIONS_PATTERN =
  "(?:mp4|png|jpg|jpeg|wav|mp3|webm|gif|mov|mkv|m4v)";
const OUTPUT_FILE_REGEX = new RegExp(
  `\\.${OUTPUT_FILE_EXTENSIONS_PATTERN}$`,
  "i"
);

/** Recursively collect all files in outputDir, returning a map of path to mtime. */
export function collectOutputFiles({
  outputDir,
}: {
  outputDir: string;
}): Map<string, number> {
  const files = new Map<string, number>();

  try {
    const pendingDirectories = [outputDir];

    while (pendingDirectories.length > 0) {
      const currentDir = pendingDirectories.pop();
      if (!currentDir) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(fullPath);
          continue;
        }

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        files.set(fullPath, stat.mtimeMs);
      }
    }
  } catch (error) {
    console.warn("[AI Pipeline] Failed to collect output files:", error);
  }

  return files;
}

/** Snapshot the current state of outputDir files before a pipeline run. */
export function captureOutputSnapshot({
  outputDir,
}: {
  outputDir: string | null;
}): Map<string, number> {
  try {
    if (!outputDir) {
      return new Map<string, number>();
    }
    return collectOutputFiles({ outputDir });
  } catch (error) {
    console.warn("[AI Pipeline] Failed to capture output snapshot:", error);
    return new Map<string, number>();
  }
}

/** Normalize a raw path string to an absolute path, returning null if invalid or nonexistent. */
export function normalizeOutputPath({
  rawPath,
  outputDir,
}: {
  rawPath: string;
  outputDir: string | null;
}): string | null {
  try {
    const trimmedPath = rawPath.trim().replace(/^["']+|["']+$/g, "");
    if (!trimmedPath) {
      return null;
    }

    const likelyAbsolutePath =
      path.isAbsolute(trimmedPath) || /^[A-Za-z]:\\/.test(trimmedPath);
    const normalizedPath = likelyAbsolutePath
      ? path.normalize(trimmedPath)
      : outputDir
        ? path.resolve(outputDir, trimmedPath)
        : path.resolve(trimmedPath);

    if (!OUTPUT_FILE_REGEX.test(normalizedPath)) {
      return null;
    }

    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    return normalizedPath;
  } catch (error) {
    console.warn("[AI Pipeline] Failed to normalize output path:", error);
    return null;
  }
}

/** Remove duplicate file paths from an array. */
export function dedupePaths({ paths }: { paths: string[] }): string[] {
  try {
    const uniquePaths = new Set<string>();
    for (const candidatePath of paths) {
      if (!candidatePath) {
        continue;
      }
      uniquePaths.add(candidatePath);
    }
    return Array.from(uniquePaths);
  } catch (error) {
    console.warn("[AI Pipeline] Failed to de-dupe output paths:", error);
    return [];
  }
}

/** Extract output file paths from pipeline stdout/stderr text using regex patterns. */
export function extractOutputPathsFromText({
  text,
  outputDir,
}: {
  text: string;
  outputDir: string | null;
}): string[] {
  const outputPaths: string[] = [];

  try {
    const labelledPattern = new RegExp(
      `(?:Output|Saved|Created|File|Path):\\s*([^\\n\\r]+?\\.${OUTPUT_FILE_EXTENSIONS_PATTERN})`,
      "gi"
    );
    const absolutePathPattern = new RegExp(
      `((?:[A-Za-z]:\\\\|/)[^\\n\\r"']+?\\.${OUTPUT_FILE_EXTENSIONS_PATTERN})`,
      "g"
    );

    for (const match of text.matchAll(labelledPattern)) {
      const normalizedPath = normalizeOutputPath({
        rawPath: match[1],
        outputDir,
      });
      if (normalizedPath) {
        outputPaths.push(normalizedPath);
      }
    }

    for (const match of text.matchAll(absolutePathPattern)) {
      const normalizedPath = normalizeOutputPath({
        rawPath: match[1],
        outputDir,
      });
      if (normalizedPath) {
        outputPaths.push(normalizedPath);
      }
    }
  } catch (error) {
    console.warn(
      "[AI Pipeline] Failed to parse output paths from text:",
      error
    );
  }

  return dedupePaths({ paths: outputPaths });
}

/** Extract output file paths from parsed JSON pipeline output by walking all string values. */
export function extractOutputPathsFromJson({
  jsonData,
  outputDir,
}: {
  jsonData: unknown;
  outputDir: string | null;
}): string[] {
  const resolvedPaths: string[] = [];

  try {
    const pendingValues: unknown[] = [jsonData];
    const visitedObjects = new Set<unknown>();

    while (pendingValues.length > 0) {
      const currentValue = pendingValues.shift();
      if (!currentValue) {
        continue;
      }

      if (typeof currentValue === "string") {
        const normalizedPath = normalizeOutputPath({
          rawPath: currentValue,
          outputDir,
        });
        if (normalizedPath) {
          resolvedPaths.push(normalizedPath);
        }
        continue;
      }

      if (Array.isArray(currentValue)) {
        for (const item of currentValue) {
          pendingValues.push(item);
        }
        continue;
      }

      if (typeof currentValue !== "object") {
        continue;
      }

      if (visitedObjects.has(currentValue)) {
        continue;
      }
      visitedObjects.add(currentValue);

      const objectValue = currentValue as Record<string, unknown>;
      for (const value of Object.values(objectValue)) {
        pendingValues.push(value);
      }
    }
  } catch (error) {
    console.warn(
      "[AI Pipeline] Failed to parse output paths from JSON:",
      error
    );
  }

  return dedupePaths({ paths: resolvedPaths });
}

/** Find new or modified files in outputDir by comparing against a pre-run snapshot. */
export function recoverOutputPathsFromDirectory({
  outputDir,
  outputSnapshot,
}: {
  outputDir: string | null;
  outputSnapshot: Map<string, number>;
}): string[] {
  try {
    if (!outputDir) {
      return [];
    }

    const afterRunFiles = collectOutputFiles({ outputDir });
    const changedFiles: Array<{ filePath: string; mtimeMs: number }> = [];

    for (const [filePath, mtimeMs] of afterRunFiles) {
      if (!OUTPUT_FILE_REGEX.test(filePath)) {
        continue;
      }

      const previousMtime = outputSnapshot.get(filePath);
      if (previousMtime === undefined || previousMtime < mtimeMs) {
        changedFiles.push({ filePath, mtimeMs });
      }
    }

    changedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return changedFiles.map((entry) => entry.filePath);
  } catch (error) {
    console.warn(
      "[AI Pipeline] Failed to recover outputs from directory:",
      error
    );
    return [];
  }
}

/** Classify a pipeline error message into a category (missing_key, binary_missing, etc.). */
export function classifyErrorCode({
  errorMessage,
}: {
  errorMessage: string;
}): string {
  try {
    const normalizedMessage = errorMessage.toLowerCase();

    if (
      normalizedMessage.includes("fal_key") ||
      normalizedMessage.includes("fal api key") ||
      normalizedMessage.includes("api key not configured")
    ) {
      return "missing_key";
    }

    if (
      normalizedMessage.includes("bundled binary") ||
      normalizedMessage.includes("not available")
    ) {
      return "binary_missing";
    }

    if (normalizedMessage.includes("timed out")) {
      return "generation_failed";
    }

    if (normalizedMessage.includes("import")) {
      return "import_failed";
    }

    return "generation_failed";
  } catch (error) {
    console.warn("[AI Pipeline] Failed to classify error:", error);
    return "generation_failed";
  }
}

/** Extract the QCut project ID from a file path matching /QCut/Projects/{id}/. */
export function inferProjectIdFromPath({
  filePath,
}: {
  filePath: string;
}): string | null {
  try {
    const normalizedPath = filePath.replace(/\\\\/g, "/");
    const projectMatch = normalizedPath.match(/\/QCut\/Projects\/([^/]+)/);
    if (!projectMatch || !projectMatch[1]) {
      return null;
    }
    return projectMatch[1];
  } catch (error) {
    console.warn("[AI Pipeline] Failed to infer project ID:", error);
    return null;
  }
}
