/**
 * Project Structure Commands
 *
 * CLI commands for initializing, organizing, and inspecting
 * project directory structures. Ported from Python
 * commands/project.py and project_structure_cli.py.
 *
 * @module electron/native-pipeline/project-commands
 */

import {
  type Dirent,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";

/** Standard QCut project directory layout. */
const PROJECT_DIRS = [
  "input",
  "input/images",
  "input/videos",
  "input/audio",
  "input/text",
  "input/pipelines",
  "output",
  "output/images",
  "output/videos",
  "output/audio",
  "config",
] as const;

/** Media file extension categories for organize-project. */
const MEDIA_CATEGORIES: Record<string, string[]> = {
  images: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"],
  videos: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"],
  audio: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"],
  text: [".txt", ".md", ".json", ".yaml", ".yml", ".csv"],
};

function getCategoryForFile(filename: string): string | undefined {
  const ext = extname(filename).toLowerCase();
  for (const [category, extensions] of Object.entries(MEDIA_CATEGORIES)) {
    if (extensions.includes(ext)) return category;
  }
  return;
}

export type InitProjectResult = {
  created: string[];
  skipped: string[];
  projectDir: string;
};

/**
 * Initialize a new project with standard directory structure.
 * Creates input/, output/, and config/ directories.
 */
export function initProject(
  directory: string,
  dryRun = false
): InitProjectResult {
  const projectDir = resolve(directory);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const dir of PROJECT_DIRS) {
    const fullPath = join(projectDir, dir);
    if (existsSync(fullPath)) {
      skipped.push(dir);
    } else {
      if (!dryRun) {
        mkdirSync(fullPath, { recursive: true });
      }
      created.push(dir);
    }
  }

  return { created, skipped, projectDir };
}

export type OrganizeResult = {
  moved: { from: string; to: string; category: string }[];
  skipped: string[];
  errors: string[];
};

/**
 * Organize files into categorized folders based on file extension.
 * Scans sourceDir and moves media files into category subdirectories.
 */
export function organizeProject(
  directory: string,
  options: {
    sourceDir?: string;
    dryRun?: boolean;
    recursive?: boolean;
    includeOutput?: boolean;
  } = {}
): OrganizeResult {
  const projectDir = resolve(directory);
  const sourceDir = options.sourceDir ? resolve(options.sourceDir) : projectDir;
  const moved: OrganizeResult["moved"] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  if (!existsSync(sourceDir)) {
    errors.push(`Source directory not found: ${sourceDir}`);
    return { moved, skipped, errors };
  }

  const outputDir = join(projectDir, "output");
  const targetBase = options.includeOutput
    ? outputDir
    : join(projectDir, "input");

  function scanDir(dir: string): void {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push(
        `Failed to read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip output/ when includeOutput is false to prevent
        // moving output files back to input during recursive scans
        if (!options.includeOutput && fullPath === outputDir) {
          continue;
        }
        if (options.recursive) {
          scanDir(fullPath);
        }
        continue;
      }

      const category = getCategoryForFile(entry.name);
      if (!category) {
        skipped.push(fullPath);
        continue;
      }

      const destDir = join(targetBase, category);
      const destPath = join(destDir, entry.name);

      if (fullPath === destPath) {
        skipped.push(fullPath);
        continue;
      }

      if (!options.dryRun) {
        mkdirSync(destDir, { recursive: true });
        try {
          renameSync(fullPath, destPath);
        } catch {
          try {
            copyFileSync(fullPath, destPath);
            unlinkSync(fullPath);
          } catch (err) {
            errors.push(
              `Failed to move ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
            );
            continue;
          }
        }
      }

      moved.push({ from: fullPath, to: destPath, category });
    }
  }

  scanDir(sourceDir);
  return { moved, skipped, errors };
}

export type StructureInfoResult = {
  projectDir: string;
  exists: boolean;
  directories: { path: string; fileCount: number; exists: boolean }[];
  totalFiles: number;
};

/**
 * Display project directory structure and file counts per category.
 */
export function getStructureInfo(directory: string): StructureInfoResult {
  const projectDir = resolve(directory);
  const exists = existsSync(projectDir);

  const directories: StructureInfoResult["directories"] = [];
  let totalFiles = 0;

  for (const dir of PROJECT_DIRS) {
    const fullPath = join(projectDir, dir);
    const dirExists = existsSync(fullPath);
    let fileCount = 0;

    if (dirExists) {
      try {
        const entries = readdirSync(fullPath, { withFileTypes: true });
        fileCount = entries.filter((e) => e.isFile()).length;
      } catch {
        // Permission error, etc.
      }
    }

    totalFiles += fileCount;
    directories.push({ path: dir, fileCount, exists: dirExists });
  }

  return { projectDir, exists, directories, totalFiles };
}
