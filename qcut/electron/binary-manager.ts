/**
 * Binary Manager - Centralized version management for bundled binaries
 *
 * Handles manifest loading, version verification, checksum validation,
 * and compatibility checks for all bundled binaries (aicp, ffmpeg, etc.)
 *
 * @module electron/binary-manager
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface BinaryManifest {
  manifestVersion: string;
  generatedAt: string;
  binaries: Record<string, BinaryEntry>;
  compatibility?: CompatibilityMatrix;
  updateChannel?: UpdateChannels;
}

export interface BinaryEntry {
  version: string;
  minQCutVersion: string;
  maxQCutVersion: string | null;
  checksum?: { sha256: string; algorithm: string };
  platforms: Record<string, PlatformEntry>;
  features?: Record<string, boolean>;
  requiredApiProviders?: string[];
  deprecationNotice: string | null;
}

export interface PlatformEntry {
  filename: string;
  size: number;
  downloadUrl?: string;
}

export interface CompatibilityMatrix {
  qcutVersions: Record<string, Record<string, string>>;
}

export interface UpdateChannels {
  stable: string;
  beta: string;
}

export interface BinaryStatus {
  name: string;
  available: boolean;
  version: string | null;
  path: string | null;
  checksumValid: boolean;
  compatible: boolean;
  updateAvailable: boolean;
  features: Record<string, boolean>;
  error?: string;
}

// ============================================================================
// Binary Manager Class
// ============================================================================

export class BinaryManager {
  private manifest: BinaryManifest | null = null;
  private manifestPath: string;
  private binDir: string;
  private qcutVersion: string;
  private checksumCache: Map<string, boolean> = new Map();

  constructor() {
    this.qcutVersion = app.getVersion();

    if (app.isPackaged) {
      this.binDir = path.join(process.resourcesPath, "bin");
      this.manifestPath = path.join(this.binDir, "manifest.json");
    } else {
      // Development: check multiple possible locations
      const devBinDir = path.join(__dirname, "..", "resources", "bin");
      const altBinDir = path.join(__dirname, "..", "..", "resources", "bin");

      if (fs.existsSync(devBinDir)) {
        this.binDir = devBinDir;
      } else if (fs.existsSync(altBinDir)) {
        this.binDir = altBinDir;
      } else {
        this.binDir = devBinDir; // Default, will be created if needed
      }
      this.manifestPath = path.join(this.binDir, "manifest.json");
    }

    this.loadManifest();
  }

  /**
   * Load the binary manifest from disk
   */
  private loadManifest(): void {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const content = fs.readFileSync(this.manifestPath, "utf-8");
        this.manifest = JSON.parse(content);
        // Only log in development to avoid leaking to production console
        if (!app.isPackaged) {
          console.log(
            `[BinaryManager] Loaded manifest v${this.manifest?.manifestVersion}`
          );
        }
      } else if (!app.isPackaged) {
        // Only warn in development - production should have bundled manifest
        console.warn(
          "[BinaryManager] No manifest found at",
          this.manifestPath,
          "- running in fallback mode"
        );
      }
    } catch (error) {
      console.error("[BinaryManager] Failed to load manifest:", error);
    }
  }

  /**
   * Reload the manifest from disk (useful after updates)
   */
  reloadManifest(): void {
    this.checksumCache.clear();
    this.loadManifest();
  }

  /**
   * Get the binary directory path
   */
  getBinDir(): string {
    return this.binDir;
  }

  /**
   * Get the current QCut version
   */
  getQCutVersion(): string {
    return this.qcutVersion;
  }

  /**
   * Check if manifest is loaded
   */
  hasManifest(): boolean {
    return this.manifest !== null;
  }

  /**
   * Get status of a specific binary
   */
  getBinaryStatus(binaryName: string): BinaryStatus {
    const entry = this.manifest?.binaries[binaryName];
    const platformKey = `${process.platform}-${process.arch}`;

    if (!entry) {
      return {
        name: binaryName,
        available: false,
        version: null,
        path: null,
        checksumValid: false,
        compatible: false,
        updateAvailable: false,
        features: {},
        error: "Binary not in manifest",
      };
    }

    const platformInfo = entry.platforms[platformKey];
    if (!platformInfo) {
      return {
        name: binaryName,
        available: false,
        version: entry.version,
        path: null,
        checksumValid: false,
        compatible: false,
        updateAvailable: false,
        features: entry.features || {},
        error: `No binary for platform: ${platformKey}`,
      };
    }

    const binaryPath = path.join(this.binDir, platformInfo.filename);
    const exists = fs.existsSync(binaryPath);

    let checksumValid = true; // Default to true if no checksum specified
    if (exists && entry.checksum) {
      checksumValid = this.verifyChecksum(binaryPath, entry.checksum.sha256);
    }

    const compatible = this.isVersionCompatible(
      entry.minQCutVersion,
      entry.maxQCutVersion
    );

    return {
      name: binaryName,
      available: exists,
      version: entry.version,
      path: exists ? binaryPath : null,
      checksumValid,
      compatible,
      updateAvailable: false, // Set by checkForUpdates()
      features: entry.features || {},
      error: !exists ? "Binary file not found" : undefined,
    };
  }

  /**
   * Get all binary statuses
   */
  getAllBinaryStatuses(): BinaryStatus[] {
    if (!this.manifest) {
      return [];
    }

    return Object.keys(this.manifest.binaries).map((name) =>
      this.getBinaryStatus(name)
    );
  }

  /**
   * Get list of all binary names in manifest
   */
  getBinaryNames(): string[] {
    if (!this.manifest) {
      return [];
    }
    return Object.keys(this.manifest.binaries);
  }

  /**
   * Verify binary checksum with caching
   */
  private verifyChecksum(filePath: string, expectedHash: string): boolean {
    // Check cache first
    const cacheKey = `${filePath}:${expectedHash}`;
    const cached = this.checksumCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const isValid = hash === expectedHash;
      this.checksumCache.set(cacheKey, isValid);

      if (!isValid && !app.isPackaged) {
        // Only log verbose checksum details in development
        console.warn(
          `[BinaryManager] Checksum mismatch for ${filePath}:`,
          `expected ${expectedHash.substring(0, 16)}...,`,
          `got ${hash.substring(0, 16)}...`
        );
      }

      return isValid;
    } catch (error) {
      console.error(`[BinaryManager] Failed to verify checksum for ${filePath}:`, error);
      this.checksumCache.set(cacheKey, false);
      return false;
    }
  }

  /**
   * Check if binary version is compatible with current QCut version
   */
  private isVersionCompatible(
    minVersion: string,
    maxVersion: string | null
  ): boolean {
    const current = this.parseVersion(this.qcutVersion);
    const min = this.parseVersion(minVersion);

    if (this.compareVersions(current, min) < 0) {
      return false;
    }

    if (maxVersion) {
      const max = this.parseVersion(maxVersion);
      if (this.compareVersions(current, max) > 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse version string into numeric array
   */
  private parseVersion(version: string): number[] {
    return version.split(".").map((n) => parseInt(n, 10) || 0);
  }

  /**
   * Compare two version arrays
   * Returns: negative if a < b, positive if a > b, 0 if equal
   */
  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }
    return 0;
  }

  /**
   * Get path to a binary, with fallback chain:
   * 1. Bundled binary (verified)
   * 2. System PATH (for development)
   * 3. null (not available)
   */
  getBinaryPath(binaryName: string): string | null {
    const status = this.getBinaryStatus(binaryName);

    // Prefer verified bundled binary
    if (status.available && status.compatible && status.checksumValid) {
      return status.path;
    }

    // In development, allow using bundled binary even without checksum verification
    if (!app.isPackaged && status.available && status.compatible) {
      console.log(
        `[BinaryManager] Using bundled binary without checksum verification (dev mode): ${binaryName}`
      );
      return status.path;
    }

    // Fallback to system PATH only in development
    if (!app.isPackaged) {
      console.log(
        `[BinaryManager] Falling back to system PATH for: ${binaryName}`
      );
      return binaryName;
    }

    // In production, don't use untrusted system binaries
    console.warn(
      `[BinaryManager] No valid bundled binary found for: ${binaryName}`
    );
    return null;
  }

  /**
   * Get features supported by a binary
   */
  getBinaryFeatures(binaryName: string): Record<string, boolean> {
    const entry = this.manifest?.binaries[binaryName];
    return entry?.features || {};
  }

  /**
   * Check if a specific feature is available for a binary
   */
  hasFeature(binaryName: string, featureName: string): boolean {
    const features = this.getBinaryFeatures(binaryName);
    return features[featureName] === true;
  }

  /**
   * Get required API providers for a binary
   */
  getRequiredApiProviders(binaryName: string): string[] {
    const entry = this.manifest?.binaries[binaryName];
    return entry?.requiredApiProviders || [];
  }

  /**
   * Check for binary updates from configured channels
   */
  async checkForUpdates(
    channel: "stable" | "beta" = "stable"
  ): Promise<{
    available: boolean;
    updates: Array<{
      binary: string;
      currentVersion: string;
      newVersion: string;
    }>;
  }> {
    if (!this.manifest?.updateChannel) {
      return { available: false, updates: [] };
    }

    const updates: Array<{
      binary: string;
      currentVersion: string;
      newVersion: string;
    }> = [];

    // TODO: Implement actual update checking by fetching from GitHub releases API
    // This is a placeholder for future implementation
    // const url = this.manifest.updateChannel[channel];
    // const response = await fetch(url);
    // const releases = await response.json();
    // ... compare versions and populate updates array

    return { available: updates.length > 0, updates };
  }

  /**
   * Get deprecation notice for a binary if any
   */
  getDeprecationNotice(binaryName: string): string | null {
    const entry = this.manifest?.binaries[binaryName];
    return entry?.deprecationNotice || null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let binaryManager: BinaryManager | null = null;

/**
 * Get the singleton BinaryManager instance
 */
export function getBinaryManager(): BinaryManager {
  if (!binaryManager) {
    binaryManager = new BinaryManager();
  }
  return binaryManager;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetBinaryManager(): void {
  binaryManager = null;
}
