import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageJsonPath = join(__dirname, "../../../../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  build?: {
    files?: Array<string | Record<string, unknown>>;
    extraResources?: Array<Record<string, unknown>>;
    asarUnpack?: string[];
  };
};

describe("FFmpeg staged packaging contract", () => {
  it("includes ffmpeg staging script", () => {
    const scriptPath = join(
      __dirname,
      "../../../../../scripts/stage-ffmpeg-binaries.ts"
    );
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("stages both macOS and Windows targets by default", () => {
    const scriptPath = join(
      __dirname,
      "../../../../../scripts/stage-ffmpeg-binaries.ts"
    );
    const scriptContent = readFileSync(scriptPath, "utf8");
    expect(scriptContent).toContain("darwin-arm64");
    expect(scriptContent).toContain("darwin-x64");
    expect(scriptContent).toContain("win32-x64");
    expect(scriptContent).toContain("linux-x64");
  });

  it("copies staged ffmpeg resources via extraResources", () => {
    const extraResources = packageJson.build?.extraResources ?? [];
    const ffmpegEntry = extraResources.find(
      (entry) =>
        entry.from === "electron/resources/ffmpeg" && entry.to === "ffmpeg"
    );
    expect(ffmpegEntry).toBeDefined();
  });

  it("does not package ffmpeg-static and ffprobe-static node_modules binaries", () => {
    const files = packageJson.build?.files ?? [];
    expect(files).not.toContain("node_modules/ffmpeg-static/**/*");
    expect(files).not.toContain("node_modules/ffprobe-static/**/*");
  });

  it("does not unpack ffmpeg-static and ffprobe-static from ASAR", () => {
    const asarUnpack = packageJson.build?.asarUnpack ?? [];
    expect(asarUnpack).not.toContain("**/node_modules/ffmpeg-static/**/*");
    expect(asarUnpack).not.toContain("**/node_modules/ffprobe-static/**/*");
  });

  it("keeps ffmpeg-ffprobe-static dependency for staging source metadata", () => {
    expect(
      packageJson.devDependencies?.["ffmpeg-ffprobe-static"]
    ).toBeDefined();
  });

  it("has no shared libraries in electron/resources root", () => {
    const resourcesDir = join(
      __dirname,
      "../../../../../../electron/resources"
    );

    if (!existsSync(resourcesDir)) {
      return;
    }

    const entries = readdirSync(resourcesDir);
    const sharedLibraries = entries.filter(
      (entry) =>
        entry.endsWith(".dll") ||
        entry.endsWith(".dylib") ||
        /\.so(\.|$)/.test(entry)
    );
    expect(sharedLibraries).toEqual([]);
  });
});
