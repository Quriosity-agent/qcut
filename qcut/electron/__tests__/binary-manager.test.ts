import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => {
  const state = {
    isPackaged: false,
    version: "0.3.67",
  };

  const appOn = vi.fn();

  return {
    state,
    appOn,
  };
});

vi.mock("electron", () => ({
  app: {
    getVersion: () => mocks.state.version,
    get isPackaged() {
      return mocks.state.isPackaged;
    },
    on: mocks.appOn,
  },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { BinaryManager } from "../binary-manager";

interface ManifestInput {
  platformKey: string;
  filename: string;
  sha256?: string;
}

function buildManifest({
  platformKey,
  filename,
  sha256,
}: ManifestInput): Record<string, unknown> {
  return {
    manifestVersion: "1.0.0",
    generatedAt: "2026-02-13T00:00:00Z",
    binaries: {
      aicp: {
        version: "1.0.0",
        minQCutVersion: "0.3.0",
        maxQCutVersion: null,
        platforms: {
          [platformKey]: {
            filename,
            size: 0,
            ...(sha256 ? { sha256 } : {}),
          },
        },
        features: {
          textToVideo: true,
        },
        requiredApiProviders: ["fal.ai"],
        deprecationNotice: null,
      },
    },
  };
}

async function writePackagedFixture({
  resourcesRoot,
  platformKey,
  filename,
  binaryContent,
  sha256,
}: {
  resourcesRoot: string;
  platformKey: string;
  filename: string;
  binaryContent: string;
  sha256?: string;
}): Promise<string> {
  try {
    const binRoot = join(resourcesRoot, "bin");
    const binaryPath = join(binRoot, "aicp", platformKey, filename);
    await mkdir(join(binRoot, "aicp", platformKey), { recursive: true });
    await writeFile(binaryPath, binaryContent, "utf8");
    await writeFile(
      join(binRoot, "manifest.json"),
      JSON.stringify(
        buildManifest({
          platformKey,
          filename,
          sha256,
        }),
        null,
        2
      ),
      "utf8"
    );
    return binaryPath;
  } catch (error: unknown) {
    throw new Error(
      `Failed to write packaged fixture: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

describe("BinaryManager", () => {
  let tmpResourcesRoot: string;
  let originalResourcesPathDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    mocks.state.version = "0.3.67";
    mocks.state.isPackaged = true;

    tmpResourcesRoot = await mkdtemp(join(tmpdir(), "qcut-binary-manager-"));

    originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(
      process,
      "resourcesPath"
    );

    Object.defineProperty(process, "resourcesPath", {
      value: tmpResourcesRoot,
      configurable: true,
    });
  });

  afterEach(async () => {
    if (originalResourcesPathDescriptor) {
      Object.defineProperty(
        process,
        "resourcesPath",
        originalResourcesPathDescriptor
      );
    } else {
      Reflect.deleteProperty(process, "resourcesPath");
    }

    await rm(tmpResourcesRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("resolves packaged aicp binary from bin/aicp/<platform>/ path", async () => {
    const platformKey = `${process.platform}-${process.arch}`;
    const filename = process.platform === "win32" ? "aicp.exe" : "aicp";
    const binaryContent = "aicp-test-binary";
    const sha256 = createHash("sha256").update(binaryContent).digest("hex");

    const expectedPath = await writePackagedFixture({
      resourcesRoot: tmpResourcesRoot,
      platformKey,
      filename,
      binaryContent,
      sha256,
    });

    const manager = new BinaryManager();
    const status = manager.getBinaryStatus("aicp");

    expect(status.available).toBe(true);
    expect(status.path).toBe(expectedPath);
    expect(status.checksumValid).toBe(true);
    expect(manager.getBinaryPath("aicp")).toBe(expectedPath);
  });

  it("marks checksum invalid and refuses packaged binary path", async () => {
    const platformKey = `${process.platform}-${process.arch}`;
    const filename = process.platform === "win32" ? "aicp.exe" : "aicp";

    await writePackagedFixture({
      resourcesRoot: tmpResourcesRoot,
      platformKey,
      filename,
      binaryContent: "content-that-does-not-match",
      sha256: "f".repeat(64),
    });

    const manager = new BinaryManager();
    const status = manager.getBinaryStatus("aicp");

    expect(status.available).toBe(true);
    expect(status.checksumValid).toBe(false);
    expect(manager.getBinaryPath("aicp")).toBeNull();
  });

  it("reports unavailable when packaged binary file is missing", async () => {
    const platformKey = `${process.platform}-${process.arch}`;
    const filename = process.platform === "win32" ? "aicp.exe" : "aicp";

    await mkdir(join(tmpResourcesRoot, "bin"), { recursive: true });
    await writeFile(
      join(tmpResourcesRoot, "bin", "manifest.json"),
      JSON.stringify(
        buildManifest({
          platformKey,
          filename,
          sha256: createHash("sha256").update("x").digest("hex"),
        }),
        null,
        2
      ),
      "utf8"
    );

    const manager = new BinaryManager();
    const status = manager.getBinaryStatus("aicp");

    expect(status.available).toBe(false);
    expect(status.path).toBeNull();
    expect(status.error).toContain("Binary file not found");
  });

  it("falls back to system PATH in development mode", () => {
    mocks.state.isPackaged = false;

    const manager = new BinaryManager();
    const resolvedPath = manager.getBinaryPath("non-existent-tool");

    expect(resolvedPath).toBe("non-existent-tool");
  });
});
