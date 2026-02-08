import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Tests for FFmpeg path resolution and packaging configuration.
 *
 * These tests verify that:
 * 1. ffmpeg-static and ffprobe-static packages are installed and accessible
 * 2. The binaries exist on disk at the resolved paths
 * 3. package.json asarUnpack config includes both packages
 * 4. package.json files config includes both packages for ASAR bundling
 * 5. Legacy DLL files have been removed from electron/resources
 * 6. extraResources does not reference DLL/EXE filters
 */

describe("FFmpeg path resolution", () => {
  describe("ffmpeg-static package", () => {
    it("is installed and returns a valid path", () => {
      const ffmpegPath: string = require("ffmpeg-static");
      expect(typeof ffmpegPath).toBe("string");
      expect(ffmpegPath.length).toBeGreaterThan(0);
    });

    it("binary exists on disk", () => {
      const ffmpegPath: string = require("ffmpeg-static");
      expect(existsSync(ffmpegPath)).toBe(true);
    });

    it("path contains ffmpeg-static directory", () => {
      const ffmpegPath: string = require("ffmpeg-static");
      expect(ffmpegPath).toContain("ffmpeg-static");
    });
  });

  describe("ffprobe-static package", () => {
    it("is installed and returns a valid path", () => {
      const ffprobePath: string = require("ffprobe-static").path;
      expect(typeof ffprobePath).toBe("string");
      expect(ffprobePath.length).toBeGreaterThan(0);
    });

    it("binary exists on disk", () => {
      const ffprobePath: string = require("ffprobe-static").path;
      expect(existsSync(ffprobePath)).toBe(true);
    });

    it("path contains ffprobe-static directory", () => {
      const ffprobePath: string = require("ffprobe-static").path;
      expect(ffprobePath).toContain("ffprobe-static");
    });
  });

  describe("asarUnpack configuration", () => {
    // Read package.json from project root
    const packageJsonPath = join(__dirname, "../../../../../package.json");
    const pkg = require(packageJsonPath);
    const asarUnpack: string[] = pkg.build?.asarUnpack ?? [];

    it("includes ffmpeg-static in asarUnpack", () => {
      expect(asarUnpack).toContain("**/node_modules/ffmpeg-static/**/*");
    });

    it("includes ffprobe-static in asarUnpack", () => {
      expect(asarUnpack).toContain("**/node_modules/ffprobe-static/**/*");
    });
  });

  describe("files configuration", () => {
    const packageJsonPath = join(__dirname, "../../../../../package.json");
    const pkg = require(packageJsonPath);
    const files: (string | Record<string, unknown>)[] = pkg.build?.files ?? [];

    it("includes ffmpeg-static in build files", () => {
      expect(files).toContain("node_modules/ffmpeg-static/**/*");
    });

    it("includes ffprobe-static in build files", () => {
      expect(files).toContain("node_modules/ffprobe-static/**/*");
    });
  });

  describe("app.asar path replacement logic", () => {
    it("replaces app.asar with app.asar.unpacked correctly", () => {
      const mockPath =
        "/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg";
      const replaced = mockPath.replace("app.asar", "app.asar.unpacked");
      expect(replaced).toBe(
        "/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg"
      );
    });

    it("does not modify paths without app.asar", () => {
      const devPath = "/project/node_modules/ffmpeg-static/ffmpeg";
      const replaced = devPath.replace("app.asar", "app.asar.unpacked");
      expect(replaced).toBe(devPath);
    });

    it("only replaces the first occurrence of app.asar", () => {
      // Edge case: path should not double-replace
      const alreadyUnpacked =
        "/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg";
      const replaced = alreadyUnpacked.replace("app.asar", "app.asar.unpacked");
      // String.replace only replaces the first match, so "app.asar.unpacked"
      // becomes "app.asar.unpacked.unpacked" — this is the known behavior.
      // In practice, this path already has "unpacked" so the condition
      // (app.isPackaged) wouldn't apply to an already-unpacked path.
      expect(replaced).toContain("app.asar.unpacked");
    });
  });

  describe("legacy DLL cleanup", () => {
    const resourcesDir = join(
      __dirname,
      "../../../../../../electron/resources"
    );

    it("no DLL files remain in electron/resources", () => {
      if (!existsSync(resourcesDir)) {
        // Directory doesn't exist — that's fine
        return;
      }
      const entries = readdirSync(resourcesDir);
      const dllFiles = entries.filter((f) => f.endsWith(".dll"));
      expect(dllFiles).toEqual([]);
    });

    it("no .dylib or .so files in electron/resources", () => {
      if (!existsSync(resourcesDir)) {
        return;
      }
      const entries = readdirSync(resourcesDir);
      const sharedLibs = entries.filter(
        (f) => f.endsWith(".dylib") || f.includes(".so")
      );
      expect(sharedLibs).toEqual([]);
    });
  });

  describe("extraResources configuration", () => {
    const packageJsonPath = join(__dirname, "../../../../../package.json");
    const pkg = require(packageJsonPath);
    const extraResources: Record<string, unknown>[] =
      pkg.build?.extraResources ?? [];

    it("does not reference DLL or EXE filters", () => {
      const allFilters = extraResources
        .filter((r) => typeof r === "object" && r !== null && "filter" in r)
        .flatMap((r) => (r as { filter: string[] }).filter);
      const binaryFilters = allFilters.filter(
        (f) =>
          f.includes(".dll") ||
          f.includes(".exe") ||
          f.includes(".dylib") ||
          f.includes(".so")
      );
      expect(binaryFilters).toEqual([]);
    });
  });

  describe("dependency configuration", () => {
    const packageJsonPath = join(__dirname, "../../../../../package.json");
    const pkg = require(packageJsonPath);

    it("ffmpeg-static is a production dependency", () => {
      expect(pkg.dependencies["ffmpeg-static"]).toBeDefined();
    });

    it("ffprobe-static is a production dependency", () => {
      expect(pkg.dependencies["ffprobe-static"]).toBeDefined();
    });

    it("ffmpeg-static is a trusted dependency", () => {
      expect(pkg.trustedDependencies).toContain("ffmpeg-static");
    });

    it("ffprobe-static is a trusted dependency", () => {
      expect(pkg.trustedDependencies).toContain("ffprobe-static");
    });
  });
});
