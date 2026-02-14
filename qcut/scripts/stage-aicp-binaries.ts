import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

interface StageTarget {
  platform: string;
  arch: string;
  key: string;
}

interface BinaryManifest {
  binaries?: {
    aicp?: {
      version?: string;
      platforms?: Record<string, AicpPlatformManifestEntry>;
    };
  };
}

interface AicpPlatformManifestEntry {
  filename: string;
  size?: number;
  sha256?: string;
  downloadUrl?: string;
}

interface VersionCheckResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string;
}

interface StagedBinary {
  path: string;
  downloaded: boolean;
}

const TARGET_ALIASES = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
} as const;

const DEFAULT_STAGE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "linux-x64",
];
const VERSION_CHECK_TIMEOUT_MS = 30000;
const MIN_BINARY_SIZE_BYTES = 1_000_000;
const MANIFEST_PATH = join(process.cwd(), "resources", "bin", "manifest.json");
const STAGING_ROOT = join(
  process.cwd(),
  "electron",
  "resources",
  "bin",
  "aicp"
);
const PACKAGED_MANIFEST_PATH = join(
  process.cwd(),
  "electron",
  "resources",
  "bin",
  "manifest.json"
);

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
      throw new Error("No AICP staging targets were provided");
    }

    return Array.from(uniqueKeys).map((key) => {
      const [platform, arch] = key.split("-");
      if (!platform || !arch) {
        throw new Error(
          `Invalid AICP target "${key}". Expected format "<platform>-<arch>".`
        );
      }
      return { platform, arch, key };
    });
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse AICP staging targets: ${getErrorMessage({ error })}`
    );
  }
}

async function loadManifest(): Promise<BinaryManifest> {
  try {
    const manifestRaw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(manifestRaw) as BinaryManifest;
  } catch (error: unknown) {
    throw new Error(
      `Failed to load binary manifest at ${MANIFEST_PATH}: ${getErrorMessage({ error })}`
    );
  }
}

async function syncManifestForPackaging(): Promise<void> {
  try {
    const manifestRaw = await readFile(MANIFEST_PATH, "utf8");
    await mkdir(join(process.cwd(), "electron", "resources", "bin"), {
      recursive: true,
    });
    await writeFile(PACKAGED_MANIFEST_PATH, manifestRaw, "utf8");
  } catch (error: unknown) {
    throw new Error(
      `Failed to sync manifest for packaging: ${getErrorMessage({ error })}`
    );
  }
}

function getBinaryName({ target }: { target: StageTarget }): string {
  try {
    return target.platform === "win32" ? "aicp.exe" : "aicp";
  } catch (error: unknown) {
    throw new Error(
      `Failed to determine AICP binary name: ${getErrorMessage({ error })}`
    );
  }
}

function isHostTarget({ target }: { target: StageTarget }): boolean {
  try {
    return target.platform === process.platform && target.arch === process.arch;
  } catch {
    return false;
  }
}

async function computeSha256({
  filePath,
}: {
  filePath: string;
}): Promise<string> {
  try {
    const buffer = await readFile(filePath);
    return createHash("sha256").update(buffer).digest("hex");
  } catch (error: unknown) {
    throw new Error(
      `Failed to compute sha256 for ${filePath}: ${getErrorMessage({ error })}`
    );
  }
}

async function runVersionCheck({
  binaryPath,
}: {
  binaryPath: string;
}): Promise<VersionCheckResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(binaryPath, ["--version"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          exitCode: null,
          stdout,
          stderr,
          error: `timed out after ${VERSION_CHECK_TIMEOUT_MS}ms`,
        });
      }, VERSION_CHECK_TIMEOUT_MS);

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (exitCode: number | null) => {
        clearTimeout(timeout);
        resolve({
          exitCode,
          stdout,
          stderr,
          error: "",
        });
      });

      proc.on("error", (error: Error) => {
        clearTimeout(timeout);
        resolve({
          exitCode: null,
          stdout,
          stderr,
          error: error.message,
        });
      });
    } catch (error: unknown) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        error: getErrorMessage({ error }),
      });
    }
  });
}

function resolveDownloadUrl({
  target,
  manifestPlatformEntry,
  binaryName,
}: {
  target: StageTarget;
  manifestPlatformEntry?: AicpPlatformManifestEntry;
  binaryName: string;
}): string {
  try {
    const baseUrl = process.env.AICP_BINARY_BASE_URL;
    if (!baseUrl) {
      const manifestUrl = manifestPlatformEntry?.downloadUrl;
      if (!manifestUrl) {
        throw new Error(
          `Missing download URL for ${target.key}. Provide AICP_BINARY_BASE_URL or add downloadUrl to manifest.`
        );
      }
      return manifestUrl;
    }

    const releaseTag =
      process.env.AICP_BINARY_RELEASE || process.env.AICP_BINARY_VERSION;
    if (!releaseTag) {
      throw new Error(
        "AICP_BINARY_BASE_URL requires AICP_BINARY_RELEASE or AICP_BINARY_VERSION"
      );
    }

    const platformAlias =
      TARGET_ALIASES[target.platform as keyof typeof TARGET_ALIASES];
    if (!platformAlias) {
      throw new Error(
        `Unsupported platform for AICP URL override: ${target.platform}`
      );
    }

    const prefix = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const suffix = `aicp-${platformAlias}-${target.arch}${binaryName.endsWith(".exe") ? ".exe" : ""}`;
    return `${prefix}${releaseTag}/${suffix}`;
  } catch (error: unknown) {
    throw new Error(
      `Failed to resolve download URL for ${target.key}: ${getErrorMessage({ error })}`
    );
  }
}

async function validateStagedBinary({
  target,
  binaryPath,
  manifestPlatformEntry,
}: {
  target: StageTarget;
  binaryPath: string;
  manifestPlatformEntry?: AicpPlatformManifestEntry;
}): Promise<void> {
  try {
    const fileStat = await stat(binaryPath);

    if (fileStat.size < MIN_BINARY_SIZE_BYTES) {
      throw new Error(
        `Binary is unexpectedly small (${fileStat.size} bytes) at ${binaryPath}`
      );
    }

    if (manifestPlatformEntry?.size && manifestPlatformEntry.size > 0) {
      if (fileStat.size !== manifestPlatformEntry.size) {
        throw new Error(
          `Size mismatch for ${target.key}: expected ${manifestPlatformEntry.size}, got ${fileStat.size}`
        );
      }
    }

    if (manifestPlatformEntry?.sha256) {
      const actualHash = await computeSha256({ filePath: binaryPath });
      if (actualHash !== manifestPlatformEntry.sha256) {
        throw new Error(
          `Checksum mismatch for ${target.key}: expected ${manifestPlatformEntry.sha256}, got ${actualHash}`
        );
      }
    }
  } catch (error: unknown) {
    throw new Error(
      `Failed to validate staged AICP binary at ${binaryPath}: ${getErrorMessage({ error })}`
    );
  }
}

async function ensureBinary({
  target,
  manifestPlatformEntry,
  forceDownload,
}: {
  target: StageTarget;
  manifestPlatformEntry?: AicpPlatformManifestEntry;
  forceDownload: boolean;
}): Promise<StagedBinary> {
  try {
    const binaryName = getBinaryName({ target });
    const destinationPath = join(STAGING_ROOT, target.key, binaryName);

    if (!forceDownload && existsSync(destinationPath)) {
      try {
        await validateStagedBinary({
          target,
          binaryPath: destinationPath,
          manifestPlatformEntry,
        });
        return {
          path: destinationPath,
          downloaded: false,
        };
      } catch {
        // Existing binary failed validation, redownload.
      }
    }

    const downloadUrl = resolveDownloadUrl({
      target,
      manifestPlatformEntry,
      binaryName,
    });

    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Download failed (${response.status} ${response.statusText}): ${downloadUrl}`
      );
    }

    const body = Buffer.from(await response.arrayBuffer());
    await writeFile(destinationPath, body);

    if (target.platform !== "win32") {
      await chmod(destinationPath, 0o755);
    }

    await validateStagedBinary({
      target,
      binaryPath: destinationPath,
      manifestPlatformEntry,
    });

    return {
      path: destinationPath,
      downloaded: true,
    };
  } catch (error: unknown) {
    throw new Error(
      `Failed to stage AICP for ${target.key}: ${getErrorMessage({ error })}`
    );
  }
}

async function stageTarget({
  target,
  manifestPlatforms,
  forceDownload,
}: {
  target: StageTarget;
  manifestPlatforms: Record<string, AicpPlatformManifestEntry>;
  forceDownload: boolean;
}): Promise<void> {
  try {
    await mkdir(join(STAGING_ROOT, target.key), { recursive: true });

    const manifestPlatformEntry = manifestPlatforms[target.key];
    const stagedBinary = await ensureBinary({
      target,
      manifestPlatformEntry,
      forceDownload,
    });

    const modeLabel = forceDownload ? "forced-download" : "cached-or-fetch";
    console.log(
      `[stage-aicp] ${target.key} (${modeLabel}): ${stagedBinary.downloaded ? "downloaded" : "cached"}`
    );

    if (!isHostTarget({ target })) {
      return;
    }

    const versionCheck = await runVersionCheck({
      binaryPath: stagedBinary.path,
    });
    if (versionCheck.error || versionCheck.exitCode !== 0) {
      throw new Error(
        `Host validation failed for ${target.key}: exit=${versionCheck.exitCode} error=${versionCheck.error} stderr=${versionCheck.stderr.trim()}`
      );
    }

    const firstLine = (versionCheck.stdout.split(/\r?\n/)[0] ?? "").trim();
    console.log(`[stage-aicp] ${target.key} version: ${firstLine}`);
  } catch (error: unknown) {
    throw new Error(
      `Failed to stage target ${target.key}: ${getErrorMessage({ error })}`
    );
  }
}

async function stageAicpBinaries(): Promise<void> {
  try {
    const defaultTargets = DEFAULT_STAGE_TARGETS.join(",");
    const rawTargets = process.env.AICP_STAGE_TARGETS || defaultTargets;
    const targets = parseTargets({ rawTargets });
    const forceDownload = process.env.AICP_STAGE_FORCE === "1";

    const manifest = await loadManifest();
    const manifestPlatforms = manifest.binaries?.aicp?.platforms;
    if (!manifestPlatforms) {
      throw new Error(
        "AICP platforms are missing from resources/bin/manifest.json"
      );
    }

    await syncManifestForPackaging();
    await mkdir(STAGING_ROOT, { recursive: true });

    console.log(`[stage-aicp] Staging root: ${STAGING_ROOT}`);
    console.log(
      `[stage-aicp] Targets: ${targets.map((target) => target.key).join(", ")}`
    );

    await Promise.all(
      targets.map((target) =>
        stageTarget({
          target,
          manifestPlatforms,
          forceDownload,
        })
      )
    );

    console.log("[stage-aicp] AICP staging completed");
  } catch (error: unknown) {
    console.error(
      `[stage-aicp] AICP staging failed: ${getErrorMessage({ error })}`
    );
    process.exit(1);
  }
}

stageAicpBinaries();
