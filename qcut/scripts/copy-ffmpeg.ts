/**
 * Copies staged FFmpeg resources for electron-packager builds.
 *
 * Source:
 *   electron/resources/ffmpeg/
 * Destination:
 *   dist-packager-new/<app>/resources/ffmpeg/
 */

import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { join } from "node:path";

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

async function resolvePackagerResourcesDir(): Promise<string> {
  try {
    const baseDir = join(process.cwd(), "dist-packager-new");
    if (!existsSync(baseDir)) {
      throw new Error(`electron-packager output not found: ${baseDir}`);
    }

    const targetDir = join(baseDir, "QCut-win32-x64", "resources");
    if (!existsSync(targetDir)) {
      throw new Error(`Packager resources dir not found: ${targetDir}`);
    }

    return targetDir;
  } catch (error: unknown) {
    throw new Error(
      `Failed to resolve packager output directory: ${getErrorMessage({ error })}`
    );
  }
}

async function copyFFmpegResources(): Promise<void> {
  try {
    const sourceDir = join(process.cwd(), "electron", "resources", "ffmpeg");
    if (!existsSync(sourceDir)) {
      throw new Error(
        `Staged FFmpeg resources not found: ${sourceDir}. Run 'bun run stage-ffmpeg-binaries' first.`
      );
    }

    const resourcesDir = await resolvePackagerResourcesDir();
    const destinationDir = join(resourcesDir, "ffmpeg");

    await cp(sourceDir, destinationDir, {
      recursive: true,
      force: true,
    });

    console.log(`Copied staged FFmpeg resources: ${sourceDir} -> ${destinationDir}`);
  } catch (error: unknown) {
    console.error(`Failed to copy staged FFmpeg resources: ${getErrorMessage({ error })}`);
    process.exit(1);
  }
}

copyFFmpegResources();
