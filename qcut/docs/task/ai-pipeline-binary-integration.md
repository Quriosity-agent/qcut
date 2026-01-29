# AI Content Pipeline Binary Integration Plan

> **Goal**: Integrate the `video-agent-skill` Python CLI binary with QCut using the spawn process pattern (Option 1) for AI content generation.

## Overview

This plan integrates the [video-agent-skill](https://github.com/donghaozhang/video-agent-skill) Python CLI (`aicp`) with QCut's Electron backend, enabling users to generate AI content (images, videos, avatars) without requiring Python installation.

### Architecture Decision

**Chosen Approach**: Spawn CLI Binary (Option 1)
- **Why**: Matches existing QCut patterns (FFmpeg handler), simpler than HTTP server, sufficient for batch operations
- **Trade-off**: Less real-time progress granularity than HTTP streaming, but consistent with existing codebase

### Key Requirements

1. Bundle pre-built binaries for Windows, macOS, and Linux
2. Fallback to system-installed `aicp` or Python module during development
3. Real-time progress updates via stdout/stderr parsing
4. Proper error handling with detailed messages
5. Session-based temp file management for outputs

---

## Version Manifest System

> **Priority**: Long-term maintainability over short-term gains

### Binary Version Manifest (`resources/bin/manifest.json`)

A centralized version manifest tracks all bundled binaries and their compatibility with QCut versions. This enables:
- Automated version checks on startup
- Graceful upgrade notifications
- Compatibility validation
- Audit trail for debugging

```json
{
  "$schema": "./manifest.schema.json",
  "manifestVersion": "1.0.0",
  "generatedAt": "2026-01-29T00:00:00Z",
  "binaries": {
    "aicp": {
      "version": "1.2.0",
      "minQCutVersion": "0.3.50",
      "maxQCutVersion": null,
      "checksum": {
        "sha256": "abc123...",
        "algorithm": "sha256"
      },
      "platforms": {
        "win32-x64": {
          "filename": "aicp.exe",
          "size": 45678901,
          "downloadUrl": "https://github.com/donghaozhang/video-agent-skill/releases/download/v1.2.0/aicp-windows-x64.exe"
        },
        "darwin-x64": {
          "filename": "aicp",
          "size": 42345678,
          "downloadUrl": "https://github.com/donghaozhang/video-agent-skill/releases/download/v1.2.0/aicp-macos-x64"
        },
        "darwin-arm64": {
          "filename": "aicp",
          "size": 41234567,
          "downloadUrl": "https://github.com/donghaozhang/video-agent-skill/releases/download/v1.2.0/aicp-macos-arm64"
        },
        "linux-x64": {
          "filename": "aicp",
          "size": 43456789,
          "downloadUrl": "https://github.com/donghaozhang/video-agent-skill/releases/download/v1.2.0/aicp-linux-x64"
        }
      },
      "features": {
        "textToVideo": true,
        "imageToVideo": true,
        "avatarGeneration": true,
        "videoUpscale": true,
        "yamlPipelines": true
      },
      "requiredApiProviders": ["fal.ai"],
      "deprecationNotice": null
    },
    "ffmpeg": {
      "version": "6.1.1",
      "minQCutVersion": "0.1.0",
      "maxQCutVersion": null,
      "checksum": {
        "sha256": "def456...",
        "algorithm": "sha256"
      },
      "platforms": {
        "win32-x64": {
          "filename": "ffmpeg.exe",
          "size": 123456789
        }
      },
      "features": {
        "h264Encoding": true,
        "h265Encoding": true,
        "vp9Encoding": true,
        "av1Encoding": false
      }
    }
  },
  "compatibility": {
    "qcutVersions": {
      "0.3.50": {
        "aicp": ">=1.0.0",
        "ffmpeg": ">=6.0.0"
      },
      "0.4.0": {
        "aicp": ">=1.2.0",
        "ffmpeg": ">=6.1.0"
      }
    }
  },
  "updateChannel": {
    "stable": "https://api.github.com/repos/donghaozhang/video-agent-skill/releases/latest",
    "beta": "https://api.github.com/repos/donghaozhang/video-agent-skill/releases?per_page=1"
  }
}
```

### Version Manifest Schema (`resources/bin/manifest.schema.json`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "QCut Binary Manifest",
  "type": "object",
  "required": ["manifestVersion", "generatedAt", "binaries"],
  "properties": {
    "manifestVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "binaries": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/definitions/BinaryEntry"
      }
    }
  },
  "definitions": {
    "BinaryEntry": {
      "type": "object",
      "required": ["version", "minQCutVersion", "platforms"],
      "properties": {
        "version": { "type": "string" },
        "minQCutVersion": { "type": "string" },
        "maxQCutVersion": { "type": ["string", "null"] },
        "checksum": {
          "type": "object",
          "properties": {
            "sha256": { "type": "string" },
            "algorithm": { "type": "string" }
          }
        },
        "platforms": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/definitions/PlatformEntry"
          }
        },
        "features": { "type": "object" },
        "deprecationNotice": { "type": ["string", "null"] }
      }
    },
    "PlatformEntry": {
      "type": "object",
      "required": ["filename", "size"],
      "properties": {
        "filename": { "type": "string" },
        "size": { "type": "integer" },
        "downloadUrl": { "type": "string", "format": "uri" }
      }
    }
  }
}
```

### Binary Manager Class

```typescript
// electron/binary-manager.ts
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface BinaryManifest {
  manifestVersion: string;
  generatedAt: string;
  binaries: Record<string, BinaryEntry>;
  compatibility: CompatibilityMatrix;
  updateChannel: UpdateChannels;
}

interface BinaryEntry {
  version: string;
  minQCutVersion: string;
  maxQCutVersion: string | null;
  checksum: { sha256: string; algorithm: string };
  platforms: Record<string, PlatformEntry>;
  features: Record<string, boolean>;
  deprecationNotice: string | null;
}

interface PlatformEntry {
  filename: string;
  size: number;
  downloadUrl?: string;
}

interface CompatibilityMatrix {
  qcutVersions: Record<string, Record<string, string>>;
}

interface UpdateChannels {
  stable: string;
  beta: string;
}

interface BinaryStatus {
  name: string;
  available: boolean;
  version: string | null;
  path: string | null;
  checksumValid: boolean;
  compatible: boolean;
  updateAvailable: boolean;
  error?: string;
}

export class BinaryManager {
  private manifest: BinaryManifest | null = null;
  private manifestPath: string;
  private binDir: string;
  private qcutVersion: string;

  constructor() {
    this.qcutVersion = app.getVersion();

    if (app.isPackaged) {
      this.binDir = path.join(process.resourcesPath, "bin");
      this.manifestPath = path.join(this.binDir, "manifest.json");
    } else {
      this.binDir = path.join(__dirname, "..", "resources", "bin");
      this.manifestPath = path.join(this.binDir, "manifest.json");
    }

    this.loadManifest();
  }

  private loadManifest(): void {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const content = fs.readFileSync(this.manifestPath, "utf-8");
        this.manifest = JSON.parse(content);
        console.log(`[BinaryManager] Loaded manifest v${this.manifest?.manifestVersion}`);
      } else {
        console.warn("[BinaryManager] No manifest found, running in fallback mode");
      }
    } catch (error) {
      console.error("[BinaryManager] Failed to load manifest:", error);
    }
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
        error: "Binary not in manifest"
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
        error: `No binary for platform: ${platformKey}`
      };
    }

    const binaryPath = path.join(this.binDir, platformInfo.filename);
    const exists = fs.existsSync(binaryPath);

    let checksumValid = false;
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
      error: !exists ? "Binary file not found" : undefined
    };
  }

  /**
   * Get all binary statuses
   */
  getAllBinaryStatuses(): BinaryStatus[] {
    if (!this.manifest) {
      return [];
    }

    return Object.keys(this.manifest.binaries).map(name =>
      this.getBinaryStatus(name)
    );
  }

  /**
   * Verify binary checksum
   */
  private verifyChecksum(filePath: string, expectedHash: string): boolean {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      return hash === expectedHash;
    } catch {
      return false;
    }
  }

  /**
   * Check if binary version is compatible with current QCut version
   */
  private isVersionCompatible(minVersion: string, maxVersion: string | null): boolean {
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

  private parseVersion(version: string): number[] {
    return version.split(".").map(n => parseInt(n, 10));
  }

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
   * 2. System PATH
   * 3. null (not available)
   */
  getBinaryPath(binaryName: string): string | null {
    const status = this.getBinaryStatus(binaryName);

    if (status.available && status.compatible) {
      return status.path;
    }

    // Fallback to system PATH (for development)
    return binaryName;
  }

  /**
   * Check for binary updates from configured channels
   */
  async checkForUpdates(channel: "stable" | "beta" = "stable"): Promise<{
    available: boolean;
    updates: Array<{ binary: string; currentVersion: string; newVersion: string }>;
  }> {
    if (!this.manifest?.updateChannel) {
      return { available: false, updates: [] };
    }

    // Implementation would fetch from GitHub releases API
    // and compare versions
    return { available: false, updates: [] };
  }
}

// Singleton instance
let binaryManager: BinaryManager | null = null;

export function getBinaryManager(): BinaryManager {
  if (!binaryManager) {
    binaryManager = new BinaryManager();
  }
  return binaryManager;
}
```

### Long-Term Support Strategy

#### 1. **Versioning Policy**
- **Semantic Versioning**: All binaries follow SemVer (MAJOR.MINOR.PATCH)
- **Compatibility Windows**: Each QCut version defines min/max compatible binary versions
- **Deprecation Period**: Minimum 2 minor versions before removing binary support

#### 2. **Update Channels**
| Channel | Use Case | Update Frequency |
|---------|----------|------------------|
| `stable` | Production users | Only tested releases |
| `beta` | Early adopters | Pre-release features |

#### 3. **Fallback Chain**
```
Priority 1: Bundled binary (verified checksum)
    ↓ (not found)
Priority 2: System-installed binary (aicp in PATH)
    ↓ (not found)
Priority 3: Python module (python -m ai_content_pipeline)
    ↓ (not found)
Priority 4: Graceful degradation (feature disabled with user notification)
```

#### 4. **Integrity Verification**
- SHA-256 checksums for all bundled binaries
- Verification on:
  - Application startup (async, non-blocking)
  - Before first use of each binary
  - After binary updates
- Failed verification triggers re-download or fallback

#### 5. **Migration Path**
When breaking changes occur:
1. New binary version released with deprecation notice for old API
2. QCut adapter layer supports both old and new APIs
3. After 2 minor versions, old API support removed
4. Clear error messages guide users to update

---

## Implementation Tasks

### Task 0: Create Binary Manager (30 min) — NEW

**Description**: Create a centralized binary version manager that handles manifest loading, version verification, and compatibility checks. This is the foundation for long-term maintainability.

**Files to Create**:
- `electron/binary-manager.ts` (NEW - ~200 lines)
- `resources/bin/manifest.json` (NEW - configuration)
- `resources/bin/manifest.schema.json` (NEW - validation)

**Implementation**: See "Binary Manager Class" section above in Version Manifest System.

**Benefits**:
- Single source of truth for all binary versions
- Automated compatibility validation
- Checksum verification for security
- Clear upgrade paths

---

### Task 1: Create AI Pipeline Handler (45 min)

**Description**: Create the main Electron IPC handler for spawning the AI pipeline binary, following the established FFmpeg handler pattern and integrating with BinaryManager.

**Files to Create/Modify**:
- `electron/ai-pipeline-handler.ts` (NEW - ~280 lines)

**Implementation Details**:

```typescript
// electron/ai-pipeline-handler.ts
import { spawn, ChildProcess, execSync } from "child_process";
import { app, ipcMain, IpcMainInvokeEvent } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getBinaryManager, BinaryManager } from "./binary-manager.js";

// ============================================================================
// Types
// ============================================================================

interface PipelineConfig {
  useBundledBinary: boolean;
  binaryPath?: string;
  pythonPath?: string;
  version?: string;
}

interface GenerateOptions {
  command: "generate-image" | "create-video" | "generate-avatar" | "list-models" | "estimate-cost";
  args: Record<string, string | number | boolean>;
  outputDir?: string;
  sessionId?: string;
}

interface PipelineProgress {
  stage: string;
  percent: number;
  message: string;
  model?: string;
  eta?: number;
}

interface PipelineResult {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  error?: string;
  duration?: number;
  cost?: number;
}

interface PipelineStatus {
  available: boolean;
  version: string | null;
  source: "bundled" | "system" | "python" | "unavailable";
  compatible: boolean;
  features: Record<string, boolean>;
  error?: string;
}

// ============================================================================
// Pipeline Manager Class
// ============================================================================

class AIPipelineManager {
  private config: PipelineConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private binaryManager: BinaryManager;

  constructor() {
    this.binaryManager = getBinaryManager();
    this.config = this.detectEnvironment();
  }

  private detectEnvironment(): PipelineConfig {
    // Priority 1: Use BinaryManager for bundled binary (preferred)
    const status = this.binaryManager.getBinaryStatus("aicp");
    if (status.available && status.compatible && status.checksumValid) {
      console.log(`[AI Pipeline] Using verified bundled binary v${status.version}:`, status.path);
      return {
        useBundledBinary: true,
        binaryPath: status.path!,
        version: status.version!
      };
    }

    // Log why bundled binary wasn't used
    if (!status.available) {
      console.log("[AI Pipeline] Bundled binary not found, trying fallbacks...");
    } else if (!status.compatible) {
      console.warn(`[AI Pipeline] Bundled binary v${status.version} not compatible with QCut v${app.getVersion()}`);
    } else if (!status.checksumValid) {
      console.warn("[AI Pipeline] Bundled binary checksum verification failed");
    }

    // Priority 2: System-installed aicp
    try {
      const version = execSync("aicp --version", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000
      }).toString().trim();
      console.log("[AI Pipeline] Using system aicp:", version);
      return { useBundledBinary: false, binaryPath: "aicp", version };
    } catch {
      // Not found
    }

    // Priority 3: Python module
    try {
      const version = execSync("python -m ai_content_pipeline --version", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000
      }).toString().trim();
      console.log("[AI Pipeline] Using Python module:", version);
      return { useBundledBinary: false, pythonPath: "python", version };
    } catch {
      // Not found
    }

    // Not available
    console.warn("[AI Pipeline] No AI pipeline binary or Python module found");
    return { useBundledBinary: false };
  }

  /**
   * Get detailed status for UI display
   */
  getStatus(): PipelineStatus {
    const binaryStatus = this.binaryManager.getBinaryStatus("aicp");

    if (this.config.binaryPath && this.config.useBundledBinary) {
      return {
        available: true,
        version: this.config.version || null,
        source: "bundled",
        compatible: binaryStatus.compatible,
        features: binaryStatus.available ? this.getFeatures() : {}
      };
    }

    if (this.config.binaryPath) {
      return {
        available: true,
        version: this.config.version || null,
        source: "system",
        compatible: true, // System binaries assumed compatible
        features: this.getFeatures()
      };
    }

    if (this.config.pythonPath) {
      return {
        available: true,
        version: this.config.version || null,
        source: "python",
        compatible: true,
        features: this.getFeatures()
      };
    }

    return {
      available: false,
      version: null,
      source: "unavailable",
      compatible: false,
      features: {},
      error: "AI Pipeline binary not found. Install aicp or bundle the binary."
    };
  }

  private getFeatures(): Record<string, boolean> {
    // Features are determined by binary version
    // In production, this would query the binary or manifest
    return {
      textToVideo: true,
      imageToVideo: true,
      avatarGeneration: true,
      videoUpscale: true,
      yamlPipelines: true
    };
  }

  private getBundledBinaryPath(): string {
    const binaryName = process.platform === "win32" ? "aicp.exe" : "aicp";

    if (app.isPackaged) {
      return path.join(process.resourcesPath, "bin", binaryName);
    }

    // Development: check resources folder
    return path.join(__dirname, "..", "resources", "bin", binaryName);
  }

  isAvailable(): boolean {
    return this.config.binaryPath !== undefined || this.config.pythonPath !== undefined;
  }

  getCommand(): { cmd: string; baseArgs: string[] } {
    if (this.config.binaryPath) {
      return { cmd: this.config.binaryPath, baseArgs: [] };
    }
    if (this.config.pythonPath) {
      return { cmd: this.config.pythonPath, baseArgs: ["-m", "ai_content_pipeline"] };
    }
    throw new Error("AI Pipeline not available");
  }

  async execute(
    options: GenerateOptions,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> {
    const { cmd, baseArgs } = this.getCommand();
    const sessionId = options.sessionId || Date.now().toString();

    // Build command arguments
    const args = [...baseArgs, options.command, "--json"];

    for (const [key, value] of Object.entries(options.args)) {
      if (value === true) {
        args.push(`--${key}`);
      } else if (value !== false && value !== undefined) {
        args.push(`--${key}`, String(value));
      }
    }

    if (options.outputDir) {
      args.push("--output-dir", options.outputDir);
    }

    return new Promise((resolve, reject) => {
      console.log("[AI Pipeline] Executing:", cmd, args.join(" "));

      const proc = spawn(cmd, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.activeProcesses.set(sessionId, proc);

      let stdout = "";
      let stderr = "";
      const startTime = Date.now();

      proc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Parse progress lines (format: PROGRESS:{"stage":"...", "percent":50, ...})
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("PROGRESS:")) {
            try {
              const progress = JSON.parse(line.slice(9)) as PipelineProgress;
              onProgress(progress);
            } catch {
              // Ignore malformed progress
            }
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;

        // Also check stderr for progress (some tools output there)
        if (text.includes("%") || text.includes("progress")) {
          const match = text.match(/(\d+)%/);
          if (match) {
            onProgress({
              stage: "processing",
              percent: parseInt(match[1], 10),
              message: text.trim(),
            });
          }
        }
      });

      proc.on("close", (code: number | null) => {
        this.activeProcesses.delete(sessionId);
        const duration = (Date.now() - startTime) / 1000;

        if (code === 0) {
          try {
            // Try to parse JSON result from stdout
            const resultMatch = stdout.match(/RESULT:(.+)$/m);
            if (resultMatch) {
              const result = JSON.parse(resultMatch[1]);
              resolve({
                success: true,
                ...result,
                duration,
              });
            } else {
              // Look for output file paths in stdout
              const pathMatch = stdout.match(/Output:\s*(.+\.(?:mp4|png|jpg|wav|mp3))/gi);
              resolve({
                success: true,
                outputPaths: pathMatch || [],
                duration,
              });
            }
          } catch {
            resolve({
              success: true,
              duration,
            });
          }
        } else {
          const errorMessage = stderr || `Process exited with code ${code}`;
          console.error("[AI Pipeline] Failed:", errorMessage);
          resolve({
            success: false,
            error: errorMessage,
            duration,
          });
        }
      });

      proc.on("error", (err: Error) => {
        this.activeProcesses.delete(sessionId);
        console.error("[AI Pipeline] Process error:", err);
        resolve({
          success: false,
          error: err.message,
        });
      });
    });
  }

  cancel(sessionId: string): boolean {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill("SIGTERM");
      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const [sessionId, proc] of this.activeProcesses) {
      proc.kill("SIGTERM");
      this.activeProcesses.delete(sessionId);
    }
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

let pipelineManager: AIPipelineManager | null = null;

export function setupAIPipelineIPC(): void {
  pipelineManager = new AIPipelineManager();

  // Check availability
  ipcMain.handle("ai-pipeline:check", async (): Promise<{ available: boolean; error?: string }> => {
    if (!pipelineManager) {
      return { available: false, error: "Pipeline manager not initialized" };
    }
    return {
      available: pipelineManager.isAvailable(),
      error: pipelineManager.isAvailable() ? undefined : "AI Pipeline binary not found. Install aicp or bundle the binary."
    };
  });

  // Generate content
  ipcMain.handle("ai-pipeline:generate", async (
    event: IpcMainInvokeEvent,
    options: GenerateOptions
  ): Promise<PipelineResult> => {
    if (!pipelineManager?.isAvailable()) {
      return { success: false, error: "AI Pipeline not available" };
    }

    return pipelineManager.execute(options, (progress) => {
      event.sender.send("ai-pipeline:progress", progress);
    });
  });

  // List available models
  ipcMain.handle("ai-pipeline:list-models", async (): Promise<PipelineResult> => {
    if (!pipelineManager?.isAvailable()) {
      return { success: false, error: "AI Pipeline not available" };
    }

    return pipelineManager.execute(
      { command: "list-models", args: {} },
      () => {} // No progress for list
    );
  });

  // Estimate cost
  ipcMain.handle("ai-pipeline:estimate-cost", async (
    _event: IpcMainInvokeEvent,
    options: { model: string; duration?: number; resolution?: string }
  ): Promise<PipelineResult> => {
    if (!pipelineManager?.isAvailable()) {
      return { success: false, error: "AI Pipeline not available" };
    }

    return pipelineManager.execute(
      {
        command: "estimate-cost",
        args: options
      },
      () => {}
    );
  });

  // Cancel generation
  ipcMain.handle("ai-pipeline:cancel", async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean }> => {
    if (!pipelineManager) {
      return { success: false };
    }
    return { success: pipelineManager.cancel(sessionId) };
  });

  console.log("[AI Pipeline] IPC handlers registered");
}

// Cleanup on app quit
app.on("before-quit", () => {
  pipelineManager?.cancelAll();
});
```

**Subtasks**:
1. Create handler file with TypeScript interfaces (15 min)
2. Implement `AIPipelineManager` class with environment detection (15 min)
3. Implement `execute()` method with progress parsing (10 min)
4. Add IPC handlers registration (5 min)

**Tests**: `apps/web/src/__tests__/electron/ai-pipeline-handler.test.ts`

---

### Task 2: Register Handler in Main Process (10 min)

**Description**: Import and register the AI pipeline handler in the Electron main process.

**Files to Modify**:
- `electron/main.ts` (~5 lines added)

**Implementation**:

```typescript
// electron/main.ts - Add to imports section (around line 12)
const { setupAIPipelineIPC } = require("./ai-pipeline-handler.js");

// Add to app.whenReady() handler (around line 80, after other setup calls)
setupAIPipelineIPC();
```

**Location**: Add after existing handler registrations like `setupFFmpegIPC()`.

---

### Task 3: Add TypeScript Type Definitions (20 min)

**Description**: Add type definitions for the AI pipeline API to the Electron types file.

**Files to Modify**:
- `apps/web/src/types/electron.d.ts` (~60 lines added)

**Implementation**:

```typescript
// apps/web/src/types/electron.d.ts - Add to ElectronAPI interface

// Add these interfaces near the top of the file (after existing interfaces)
export interface AIPipelineProgress {
  stage: string;
  percent: number;
  message: string;
  model?: string;
  eta?: number;
}

export interface AIPipelineGenerateOptions {
  command: "generate-image" | "create-video" | "generate-avatar" | "list-models" | "estimate-cost";
  args: Record<string, string | number | boolean>;
  outputDir?: string;
  sessionId?: string;
}

export interface AIPipelineResult {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  error?: string;
  duration?: number;
  cost?: number;
}

export interface AIPipelineCostEstimate {
  model: string;
  duration?: number;
  resolution?: string;
}

// Add to ElectronAPI interface (inside the interface definition)
export interface ElectronAPI {
  // ... existing properties ...

  aiPipeline: {
    /** Check if AI pipeline binary is available */
    check(): Promise<{ available: boolean; error?: string }>;

    /** Generate content (image, video, avatar) */
    generate(options: AIPipelineGenerateOptions): Promise<AIPipelineResult>;

    /** List available AI models */
    listModels(): Promise<AIPipelineResult>;

    /** Estimate generation cost */
    estimateCost(options: AIPipelineCostEstimate): Promise<AIPipelineResult>;

    /** Cancel ongoing generation */
    cancel(sessionId: string): Promise<{ success: boolean }>;

    /** Listen for progress updates */
    onProgress(callback: (progress: AIPipelineProgress) => void): () => void;
  };
}
```

---

### Task 4: Update Preload Script (15 min)

**Description**: Expose the AI pipeline API through the context bridge in the preload script.

**Files to Modify**:
- `electron/preload.ts` (~35 lines added)

**Implementation**:

```typescript
// electron/preload.ts - Add to electronAPI object

aiPipeline: {
  check: (): Promise<{ available: boolean; error?: string }> =>
    ipcRenderer.invoke("ai-pipeline:check"),

  generate: (options: {
    command: string;
    args: Record<string, string | number | boolean>;
    outputDir?: string;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    outputPath?: string;
    outputPaths?: string[];
    error?: string;
    duration?: number;
  }> => ipcRenderer.invoke("ai-pipeline:generate", options),

  listModels: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("ai-pipeline:list-models"),

  estimateCost: (options: {
    model: string;
    duration?: number;
    resolution?: string;
  }): Promise<{ success: boolean; error?: string; cost?: number }> =>
    ipcRenderer.invoke("ai-pipeline:estimate-cost", options),

  cancel: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("ai-pipeline:cancel", sessionId),

  onProgress: (
    callback: (progress: {
      stage: string;
      percent: number;
      message: string;
      model?: string;
      eta?: number;
    }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on("ai-pipeline:progress", handler);
    return () => {
      ipcRenderer.removeListener("ai-pipeline:progress", handler);
    };
  },
},
```

---

### Task 5: Create React Hook for AI Pipeline (25 min)

**Description**: Create a React hook for easy integration with the AI pipeline from components.

**Files to Create**:
- `apps/web/src/hooks/use-ai-pipeline.ts` (NEW - ~100 lines)

**Implementation**:

```typescript
// apps/web/src/hooks/use-ai-pipeline.ts
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AIPipelineProgress,
  AIPipelineGenerateOptions,
  AIPipelineResult
} from "@/types/electron";

interface UseAIPipelineOptions {
  onProgress?: (progress: AIPipelineProgress) => void;
  onComplete?: (result: AIPipelineResult) => void;
  onError?: (error: string) => void;
}

interface UseAIPipelineReturn {
  /** Whether the AI pipeline binary is available */
  isAvailable: boolean;
  /** Whether a generation is currently in progress */
  isGenerating: boolean;
  /** Current progress state */
  progress: AIPipelineProgress | null;
  /** Last result from generation */
  result: AIPipelineResult | null;
  /** Error message if any */
  error: string | null;
  /** Generate content (image, video, avatar) */
  generate: (options: AIPipelineGenerateOptions) => Promise<AIPipelineResult>;
  /** List available models */
  listModels: () => Promise<AIPipelineResult>;
  /** Estimate cost for generation */
  estimateCost: (model: string, duration?: number) => Promise<AIPipelineResult>;
  /** Cancel ongoing generation */
  cancel: () => Promise<void>;
  /** Check and refresh availability status */
  checkAvailability: () => Promise<boolean>;
}

export function useAIPipeline(options: UseAIPipelineOptions = {}): UseAIPipelineReturn {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<AIPipelineProgress | null>(null);
  const [result, setResult] = useState<AIPipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const { onProgress, onComplete, onError } = options;

  // Check availability on mount
  useEffect(() => {
    checkAvailability();
  }, []);

  // Set up progress listener
  useEffect(() => {
    if (!window.electronAPI?.aiPipeline?.onProgress) return;

    const cleanup = window.electronAPI.aiPipeline.onProgress((progressData) => {
      setProgress(progressData);
      onProgress?.(progressData);
    });

    return cleanup;
  }, [onProgress]);

  const checkAvailability = useCallback(async (): Promise<boolean> => {
    try {
      const response = await window.electronAPI?.aiPipeline?.check();
      const available = response?.available ?? false;
      setIsAvailable(available);
      if (!available && response?.error) {
        setError(response.error);
      }
      return available;
    } catch (err) {
      setIsAvailable(false);
      setError("Failed to check AI pipeline availability");
      return false;
    }
  }, []);

  const generate = useCallback(async (
    generateOptions: AIPipelineGenerateOptions
  ): Promise<AIPipelineResult> => {
    if (!isAvailable) {
      const unavailableResult = { success: false, error: "AI Pipeline not available" };
      setResult(unavailableResult);
      onError?.(unavailableResult.error!);
      return unavailableResult;
    }

    setIsGenerating(true);
    setProgress({ stage: "starting", percent: 0, message: "Initializing..." });
    setError(null);
    setResult(null);

    // Generate session ID for cancellation
    const sessionId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = sessionId;

    try {
      const generateResult = await window.electronAPI?.aiPipeline?.generate({
        ...generateOptions,
        sessionId,
      });

      if (!generateResult) {
        throw new Error("No response from AI pipeline");
      }

      setResult(generateResult);

      if (generateResult.success) {
        onComplete?.(generateResult);
      } else if (generateResult.error) {
        setError(generateResult.error);
        onError?.(generateResult.error);
      }

      return generateResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const errorResult = { success: false, error: errorMessage };
      setError(errorMessage);
      setResult(errorResult);
      onError?.(errorMessage);
      return errorResult;
    } finally {
      setIsGenerating(false);
      setProgress(null);
      sessionIdRef.current = null;
    }
  }, [isAvailable, onComplete, onError]);

  const listModels = useCallback(async (): Promise<AIPipelineResult> => {
    if (!isAvailable) {
      return { success: false, error: "AI Pipeline not available" };
    }
    return window.electronAPI?.aiPipeline?.listModels() ?? { success: false, error: "API not available" };
  }, [isAvailable]);

  const estimateCost = useCallback(async (
    model: string,
    duration?: number
  ): Promise<AIPipelineResult> => {
    if (!isAvailable) {
      return { success: false, error: "AI Pipeline not available" };
    }
    return window.electronAPI?.aiPipeline?.estimateCost({ model, duration }) ?? { success: false, error: "API not available" };
  }, [isAvailable]);

  const cancel = useCallback(async (): Promise<void> => {
    if (sessionIdRef.current) {
      await window.electronAPI?.aiPipeline?.cancel(sessionIdRef.current);
      sessionIdRef.current = null;
      setIsGenerating(false);
      setProgress(null);
    }
  }, []);

  return {
    isAvailable,
    isGenerating,
    progress,
    result,
    error,
    generate,
    listModels,
    estimateCost,
    cancel,
    checkAvailability,
  };
}
```

---

### Task 6: Create Binary Build Script (30 min)

**Description**: Create a script to build the Python CLI as a standalone binary using PyInstaller.

**Files to Create**:
- `scripts/build-ai-pipeline.py` (NEW - in video-agent-skill repo)
- `scripts/download-ai-pipeline.ts` (NEW - ~80 lines, for QCut)

**QCut Download Script**:

```typescript
// scripts/download-ai-pipeline.ts
/**
 * Downloads pre-built AI pipeline binaries from GitHub releases
 * Run: bun scripts/download-ai-pipeline.ts
 */
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";

const REPO = "donghaozhang/video-agent-skill";
const BINARY_NAME = process.platform === "win32" ? "aicp.exe" : "aicp";
const TARGET_DIR = path.join(__dirname, "..", "resources", "bin");

interface GithubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

async function getLatestRelease(): Promise<GithubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.statusText}`);
  }
  return response.json();
}

function getPlatformAssetName(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") return "aicp-windows-x64.exe";
  if (platform === "darwin") {
    return arch === "arm64" ? "aicp-macos-arm64" : "aicp-macos-x64";
  }
  return "aicp-linux-x64";
}

async function downloadBinary(): Promise<void> {
  console.log("Fetching latest release info...");
  const release = await getLatestRelease();
  console.log(`Latest version: ${release.tag_name}`);

  const assetName = getPlatformAssetName();
  const asset = release.assets.find((a) => a.name === assetName);

  if (!asset) {
    console.error(`No binary found for platform: ${assetName}`);
    console.log("Available assets:", release.assets.map((a) => a.name).join(", "));
    process.exit(1);
  }

  // Ensure target directory exists
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const targetPath = path.join(TARGET_DIR, BINARY_NAME);
  console.log(`Downloading ${asset.name} to ${targetPath}...`);

  const response = await fetch(asset.browser_download_url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(targetPath);
  // @ts-ignore - Node.js stream compatibility
  await pipeline(response.body, fileStream);

  // Make executable on Unix
  if (process.platform !== "win32") {
    fs.chmodSync(targetPath, 0o755);
  }

  console.log(`Successfully downloaded AI pipeline binary to ${targetPath}`);
}

downloadBinary().catch((err) => {
  console.error("Failed to download binary:", err);
  process.exit(1);
});
```

**Add to package.json**:

```json
{
  "scripts": {
    "download:ai-pipeline": "bun scripts/download-ai-pipeline.ts",
    "postinstall": "bun run download:ai-pipeline || echo 'AI pipeline binary download skipped'"
  }
}
```

---

### Task 7: Add Resources Directory to Electron Build (10 min)

**Description**: Configure Electron packaging to include the AI pipeline binary.

**Files to Modify**:
- `package.json` (electron-builder config)
- `electron-builder.json` (if exists) or `package.json` build section

**Implementation**:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/bin/",
        "to": "bin/",
        "filter": ["**/*"]
      }
    ]
  }
}
```

---

### Task 8: Create Unit Tests (35 min)

**Description**: Create comprehensive unit tests for the AI pipeline integration.

**Files to Create**:
- `apps/web/src/__tests__/hooks/use-ai-pipeline.test.ts` (NEW - ~150 lines)
- `apps/web/src/__tests__/electron/ai-pipeline-handler.test.ts` (NEW - ~100 lines)

**Hook Tests**:

```typescript
// apps/web/src/__tests__/hooks/use-ai-pipeline.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAIPipeline } from "@/hooks/use-ai-pipeline";

// Mock electronAPI
const mockElectronAPI = {
  aiPipeline: {
    check: vi.fn(),
    generate: vi.fn(),
    listModels: vi.fn(),
    estimateCost: vi.fn(),
    cancel: vi.fn(),
    onProgress: vi.fn(() => () => {}),
  },
};

describe("useAIPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = mockElectronAPI;
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  describe("availability check", () => {
    it("should check availability on mount", async () => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: true });

      const { result } = renderHook(() => useAIPipeline());

      await waitFor(() => {
        expect(result.current.isAvailable).toBe(true);
      });

      expect(mockElectronAPI.aiPipeline.check).toHaveBeenCalledOnce();
    });

    it("should set error when not available", async () => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({
        available: false,
        error: "Binary not found",
      });

      const { result } = renderHook(() => useAIPipeline());

      await waitFor(() => {
        expect(result.current.isAvailable).toBe(false);
        expect(result.current.error).toBe("Binary not found");
      });
    });
  });

  describe("generate", () => {
    beforeEach(() => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: true });
    });

    it("should generate content successfully", async () => {
      const mockResult = {
        success: true,
        outputPath: "/path/to/output.mp4",
        duration: 5.2,
      };
      mockElectronAPI.aiPipeline.generate.mockResolvedValue(mockResult);

      const { result } = renderHook(() => useAIPipeline());

      await waitFor(() => expect(result.current.isAvailable).toBe(true));

      let generateResult: any;
      await act(async () => {
        generateResult = await result.current.generate({
          command: "create-video",
          args: { prompt: "A sunset", model: "sora-2" },
        });
      });

      expect(generateResult).toEqual(mockResult);
      expect(result.current.result).toEqual(mockResult);
      expect(result.current.isGenerating).toBe(false);
    });

    it("should handle generation errors", async () => {
      const onError = vi.fn();
      mockElectronAPI.aiPipeline.generate.mockResolvedValue({
        success: false,
        error: "API key invalid",
      });

      const { result } = renderHook(() => useAIPipeline({ onError }));

      await waitFor(() => expect(result.current.isAvailable).toBe(true));

      await act(async () => {
        await result.current.generate({
          command: "generate-image",
          args: { prompt: "test" },
        });
      });

      expect(onError).toHaveBeenCalledWith("API key invalid");
      expect(result.current.error).toBe("API key invalid");
    });

    it("should return error when pipeline not available", async () => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: false });

      const { result } = renderHook(() => useAIPipeline());

      await waitFor(() => expect(result.current.isAvailable).toBe(false));

      let generateResult: any;
      await act(async () => {
        generateResult = await result.current.generate({
          command: "create-video",
          args: {},
        });
      });

      expect(generateResult.success).toBe(false);
      expect(generateResult.error).toContain("not available");
    });
  });

  describe("cancel", () => {
    it("should cancel ongoing generation", async () => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: true });
      mockElectronAPI.aiPipeline.cancel.mockResolvedValue({ success: true });

      // Simulate a long-running generation
      mockElectronAPI.aiPipeline.generate.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10000))
      );

      const { result } = renderHook(() => useAIPipeline());

      await waitFor(() => expect(result.current.isAvailable).toBe(true));

      // Start generation (don't await)
      act(() => {
        result.current.generate({ command: "create-video", args: {} });
      });

      // Cancel immediately
      await act(async () => {
        await result.current.cancel();
      });

      expect(mockElectronAPI.aiPipeline.cancel).toHaveBeenCalled();
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe("progress updates", () => {
    it("should set up progress listener", async () => {
      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: true });

      renderHook(() => useAIPipeline());

      expect(mockElectronAPI.aiPipeline.onProgress).toHaveBeenCalled();
    });

    it("should call onProgress callback", async () => {
      const onProgress = vi.fn();
      let progressCallback: ((p: any) => void) | undefined;

      mockElectronAPI.aiPipeline.check.mockResolvedValue({ available: true });
      mockElectronAPI.aiPipeline.onProgress.mockImplementation((cb) => {
        progressCallback = cb;
        return () => {};
      });

      const { result } = renderHook(() => useAIPipeline({ onProgress }));

      await waitFor(() => expect(result.current.isAvailable).toBe(true));

      // Simulate progress update
      const progressData = { stage: "generating", percent: 50, message: "Half done" };
      act(() => {
        progressCallback?.(progressData);
      });

      expect(onProgress).toHaveBeenCalledWith(progressData);
      expect(result.current.progress).toEqual(progressData);
    });
  });
});
```

---

### Task 9: Documentation (15 min)

**Description**: Create developer documentation for the AI pipeline integration.

**Files to Create**:
- `docs/ai-pipeline-integration.md` (NEW - ~100 lines)

**Content Outline**:
1. Overview and architecture
2. Binary installation (bundled vs system)
3. API reference (IPC handlers, React hook)
4. Usage examples
5. Troubleshooting guide
6. Building from source

---

## Summary

| Task | Priority | Files |
|------|----------|-------|
| 0. Create Binary Manager | High | `electron/binary-manager.ts`, `resources/bin/manifest.json` |
| 1. Create AI Pipeline Handler | High | `electron/ai-pipeline-handler.ts` |
| 2. Register in Main Process | High | `electron/main.ts` |
| 3. TypeScript Definitions | High | `apps/web/src/types/electron.d.ts` |
| 4. Update Preload Script | High | `electron/preload.ts` |
| 5. Create React Hook | Medium | `apps/web/src/hooks/use-ai-pipeline.ts` |
| 6. Binary Build Script | Medium | `scripts/download-ai-pipeline.ts` |
| 7. Electron Build Config | Medium | `package.json` |
| 8. Unit Tests | Medium | `apps/web/src/__tests__/hooks/use-ai-pipeline.test.ts` |
| 9. Documentation | Low | `docs/ai-pipeline-integration.md` |

**Note**: Time estimates intentionally omitted per project guidelines.

---

## File Paths Reference

### Files to Create
- `electron/binary-manager.ts` (NEW - version manifest management)
- `electron/ai-pipeline-handler.ts`
- `resources/bin/manifest.json` (NEW - binary version manifest)
- `resources/bin/manifest.schema.json` (NEW - JSON schema for validation)
- `apps/web/src/hooks/use-ai-pipeline.ts`
- `scripts/download-ai-pipeline.ts`
- `resources/bin/` (directory for binaries)
- `apps/web/src/__tests__/hooks/use-ai-pipeline.test.ts`
- `apps/web/src/__tests__/electron/binary-manager.test.ts` (NEW)
- `docs/ai-pipeline-integration.md`

### Files to Modify
- `electron/main.ts` (import and register handlers)
- `electron/preload.ts` (expose API)
- `apps/web/src/types/electron.d.ts` (add types)
- `package.json` (build config, scripts)

---

## Dependencies

### Runtime Dependencies
- Pre-built `aicp` binary from `video-agent-skill` repository
- OR Python 3.10+ with `pip install ai-content-pipeline` (fallback)

### Build Dependencies
- None (no new npm dependencies required)

### Binary Distribution
| Platform | Binary | Source |
|----------|--------|--------|
| Windows x64 | `aicp.exe` | GitHub Releases |
| macOS x64 | `aicp` | GitHub Releases |
| macOS ARM64 | `aicp` | GitHub Releases |
| Linux x64 | `aicp` | GitHub Releases |

### API Providers
- **FAL.ai**: Required for all AI content generation
  - Environment variable: `FAL_API_KEY` or `VITE_FAL_API_KEY`
  - Configured via QCut Settings → API Keys

---

## Future Enhancements

### Phase 2: Advanced Features
1. **HTTP Server Mode**: For real-time streaming progress (Option 2)
2. **YAML Pipeline Support**: Run complex multi-step pipelines
3. **Cost Tracking**: Track API usage and costs per project
4. **Model Caching**: Cache model lists for offline display

### Phase 3: Enterprise Features
5. **Auto-Update System**: Prompt users to update binaries when new versions available
6. **Telemetry Integration**: Anonymous usage stats for feature prioritization
7. **Custom Binary Sources**: Allow enterprise users to host their own binaries
8. **Offline Model Support**: Local AI models for air-gapped environments

---

## Long-Term Maintenance Considerations

### Binary Update Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Binary Update Lifecycle                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. New binary version released on GitHub                           │
│         ↓                                                          │
│  2. CI/CD generates new manifest.json with checksums                │
│         ↓                                                          │
│  3. QCut startup checks for updates (async, non-blocking)           │
│         ↓                                                          │
│  4. User notified of available update (toast notification)          │
│         ↓                                                          │
│  5. User confirms update OR auto-update if minor version            │
│         ↓                                                          │
│  6. Download new binary to temp location                            │
│         ↓                                                          │
│  7. Verify checksum before replacing                                │
│         ↓                                                          │
│  8. Atomic replace (rename operation)                               │
│         ↓                                                          │
│  9. Update manifest.json with new version                           │
│         ↓                                                          │
│  10. Log update completion for audit trail                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Deprecation Policy

| Scenario | Action | Timeline |
|----------|--------|----------|
| New binary version with backward-compatible API | Add to manifest, no user action needed | Immediate |
| New binary version with deprecated features | Add deprecation notice in manifest | 2 minor versions |
| Breaking API change | Major version bump, adapter layer | 1 major version transition period |
| Security vulnerability in binary | Force update, block old version | Immediate |

### Monitoring & Observability

Track the following metrics (when telemetry enabled):
- Binary version distribution across user base
- Checksum verification failures (potential security issues)
- Fallback usage rates (bundled vs system vs Python)
- Feature usage by binary version
- Update success/failure rates

### Rollback Procedure

If a binary update causes issues:
1. Keep previous version in `resources/bin/previous/`
2. Manifest includes `rollbackVersion` field
3. User can trigger rollback from Settings → Advanced → Binaries
4. Automatic rollback on 3 consecutive startup failures

### Security Considerations

1. **Supply Chain Security**
   - All binaries built from tagged releases
   - Checksums generated in CI, signed by maintainer
   - Manifest includes provenance information

2. **Runtime Security**
   - Binaries run in subprocess isolation
   - No shell injection (use spawn, not exec)
   - Output sanitization before display

3. **Update Security**
   - HTTPS-only for downloads
   - Checksum verification mandatory
   - No code execution from downloaded content until verified
