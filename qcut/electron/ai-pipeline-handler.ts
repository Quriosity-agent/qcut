/**
 * AI Pipeline Handler - Electron IPC handler for AI content generation
 *
 * Spawns the aicp CLI binary to generate AI content (images, videos, avatars)
 * following the established FFmpeg handler pattern.
 *
 * @module electron/ai-pipeline-handler
 */
import { spawn, ChildProcess, execSync } from "child_process";
import { app, ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
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

export interface GenerateOptions {
  command:
    | "generate-image"
    | "create-video"
    | "generate-avatar"
    | "list-models"
    | "estimate-cost"
    | "run-pipeline";
  args: Record<string, string | number | boolean>;
  outputDir?: string;
  sessionId?: string;
}

export interface PipelineProgress {
  stage: string;
  percent: number;
  message: string;
  model?: string;
  eta?: number;
}

export interface PipelineResult {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  error?: string;
  duration?: number;
  cost?: number;
  models?: string[];
  data?: unknown;
}

export interface PipelineStatus {
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

  /**
   * Detect available AI pipeline binary/module
   * Priority: Bundled binary > System aicp > Python module
   */
  private detectEnvironment(): PipelineConfig {
    // Priority 1: Use BinaryManager for bundled binary (preferred)
    const status = this.binaryManager.getBinaryStatus("aicp");
    if (status.available && status.compatible) {
      console.log(
        `[AI Pipeline] Using bundled binary v${status.version}:`,
        status.path
      );
      return {
        useBundledBinary: true,
        binaryPath: status.path!,
        version: status.version!,
      };
    }

    // Log why bundled binary wasn't used
    if (!status.available) {
      console.log("[AI Pipeline] Bundled binary not found, trying fallbacks...");
    } else if (!status.compatible) {
      console.warn(
        `[AI Pipeline] Bundled binary v${status.version} not compatible with QCut v${app.getVersion()}`
      );
    }

    // Priority 2: System-installed aicp
    try {
      const version = execSync("aicp --version", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
        .toString()
        .trim();
      console.log("[AI Pipeline] Using system aicp:", version);
      return { useBundledBinary: false, binaryPath: "aicp", version };
    } catch {
      // Not found in PATH
    }

    // Priority 3: Python module
    try {
      const version = execSync("python -m ai_content_pipeline --version", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
        .toString()
        .trim();
      console.log("[AI Pipeline] Using Python module:", version);
      return { useBundledBinary: false, pythonPath: "python", version };
    } catch {
      // Not found
    }

    // Try python3 on Unix systems
    if (process.platform !== "win32") {
      try {
        const version = execSync("python3 -m ai_content_pipeline --version", {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        })
          .toString()
          .trim();
        console.log("[AI Pipeline] Using Python3 module:", version);
        return { useBundledBinary: false, pythonPath: "python3", version };
      } catch {
        // Not found
      }
    }

    // Not available
    console.warn("[AI Pipeline] No AI pipeline binary or Python module found");
    return { useBundledBinary: false };
  }

  /**
   * Refresh environment detection (useful after binary installation)
   */
  refreshEnvironment(): void {
    this.binaryManager.reloadManifest();
    this.config = this.detectEnvironment();
  }

  /**
   * Check if AI pipeline is available
   */
  isAvailable(): boolean {
    return (
      this.config.binaryPath !== undefined ||
      this.config.pythonPath !== undefined
    );
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
        features: binaryStatus.features,
      };
    }

    if (this.config.binaryPath) {
      return {
        available: true,
        version: this.config.version || null,
        source: "system",
        compatible: true, // System binaries assumed compatible
        features: this.getDefaultFeatures(),
      };
    }

    if (this.config.pythonPath) {
      return {
        available: true,
        version: this.config.version || null,
        source: "python",
        compatible: true,
        features: this.getDefaultFeatures(),
      };
    }

    return {
      available: false,
      version: null,
      source: "unavailable",
      compatible: false,
      features: {},
      error:
        "AI Pipeline binary not found. Install aicp or the ai_content_pipeline Python package.",
    };
  }

  /**
   * Get default features when manifest is not available
   */
  private getDefaultFeatures(): Record<string, boolean> {
    return {
      textToVideo: true,
      imageToVideo: true,
      avatarGeneration: true,
      videoUpscale: true,
      yamlPipelines: true,
    };
  }

  /**
   * Get command and base arguments for execution
   */
  private getCommand(): { cmd: string; baseArgs: string[] } {
    if (this.config.binaryPath) {
      return { cmd: this.config.binaryPath, baseArgs: [] };
    }
    if (this.config.pythonPath) {
      return { cmd: this.config.pythonPath, baseArgs: ["-m", "ai_content_pipeline"] };
    }
    throw new Error("AI Pipeline not available");
  }

  /**
   * Execute an AI pipeline command
   */
  async execute(
    options: GenerateOptions,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> {
    if (!this.isAvailable()) {
      return { success: false, error: "AI Pipeline not available" };
    }

    const { cmd, baseArgs } = this.getCommand();
    const sessionId = options.sessionId || `ai-${Date.now()}`;

    // Build command arguments
    const args = [...baseArgs, options.command];

    // Add JSON output flag for parseable results
    if (!options.args["no-json"]) {
      args.push("--json");
    }

    // Add all provided arguments
    for (const [key, value] of Object.entries(options.args)) {
      if (key === "no-json") continue; // Skip internal flag

      if (value === true) {
        args.push(`--${key}`);
      } else if (value !== false && value !== undefined && value !== "") {
        args.push(`--${key}`, String(value));
      }
    }

    // Add output directory if specified
    if (options.outputDir) {
      args.push("--output-dir", options.outputDir);
    }

    return new Promise((resolve) => {
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

      // Handle stdout
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
              // Ignore malformed progress lines
            }
          }
        }
      });

      // Handle stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;

        // Also check stderr for progress (some tools output there)
        if (text.includes("%") || text.toLowerCase().includes("progress")) {
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

      // Handle process completion
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
              return;
            }

            // Try to parse entire stdout as JSON
            const trimmedOutput = stdout.trim();
            if (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("[")) {
              try {
                const jsonResult = JSON.parse(trimmedOutput);
                resolve({
                  success: true,
                  data: jsonResult,
                  duration,
                });
                return;
              } catch {
                // Not valid JSON, continue
              }
            }

            // Look for output file paths in stdout
            const pathMatches = stdout.match(
              /(?:Output|Saved|Created):\s*(.+\.(?:mp4|png|jpg|jpeg|wav|mp3|webm|gif))/gi
            );
            if (pathMatches) {
              const paths = pathMatches.map((m) =>
                m.replace(/^(?:Output|Saved|Created):\s*/i, "").trim()
              );
              resolve({
                success: true,
                outputPaths: paths,
                outputPath: paths[0],
                duration,
              });
              return;
            }

            // Success with no specific output
            resolve({
              success: true,
              duration,
            });
          } catch (parseError) {
            console.warn("[AI Pipeline] Failed to parse output:", parseError);
            resolve({
              success: true,
              duration,
            });
          }
        } else {
          const errorMessage =
            stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
          console.error("[AI Pipeline] Failed:", errorMessage);
          resolve({
            success: false,
            error: errorMessage,
            duration,
          });
        }
      });

      // Handle process errors
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

  /**
   * Cancel a running generation by session ID
   */
  cancel(sessionId: string): boolean {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill("SIGTERM");
      this.activeProcesses.delete(sessionId);
      console.log(`[AI Pipeline] Cancelled session: ${sessionId}`);
      return true;
    }
    return false;
  }

  /**
   * Cancel all running generations
   */
  cancelAll(): void {
    for (const [sessionId, proc] of this.activeProcesses) {
      proc.kill("SIGTERM");
      console.log(`[AI Pipeline] Cancelled session: ${sessionId}`);
    }
    this.activeProcesses.clear();
  }

  /**
   * Get count of active processes
   */
  getActiveCount(): number {
    return this.activeProcesses.size;
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

let pipelineManager: AIPipelineManager | null = null;

/**
 * Get the current main window for sending progress updates
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Setup AI Pipeline IPC handlers
 */
export function setupAIPipelineIPC(): void {
  pipelineManager = new AIPipelineManager();

  // Check availability and get status
  ipcMain.handle(
    "ai-pipeline:check",
    async (): Promise<{ available: boolean; error?: string }> => {
      if (!pipelineManager) {
        return { available: false, error: "Pipeline manager not initialized" };
      }
      const status = pipelineManager.getStatus();
      return {
        available: status.available,
        error: status.error,
      };
    }
  );

  // Get detailed status
  ipcMain.handle("ai-pipeline:status", async (): Promise<PipelineStatus> => {
    if (!pipelineManager) {
      return {
        available: false,
        version: null,
        source: "unavailable",
        compatible: false,
        features: {},
        error: "Pipeline manager not initialized",
      };
    }
    return pipelineManager.getStatus();
  });

  // Generate content (image, video, avatar)
  ipcMain.handle(
    "ai-pipeline:generate",
    async (
      event: IpcMainInvokeEvent,
      options: GenerateOptions
    ): Promise<PipelineResult> => {
      if (!pipelineManager?.isAvailable()) {
        return { success: false, error: "AI Pipeline not available" };
      }

      // Generate sessionId if not provided to ensure correlation
      const sessionId = options.sessionId ?? `ai-${Date.now()}`;
      return pipelineManager.execute({ ...options, sessionId }, (progress) => {
        // Send progress to renderer
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("ai-pipeline:progress", {
            sessionId,
            ...progress,
          });
        }
      });
    }
  );

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
  ipcMain.handle(
    "ai-pipeline:estimate-cost",
    async (
      _event: IpcMainInvokeEvent,
      options: { model: string; duration?: number; resolution?: string }
    ): Promise<PipelineResult> => {
      if (!pipelineManager?.isAvailable()) {
        return { success: false, error: "AI Pipeline not available" };
      }

      return pipelineManager.execute(
        {
          command: "estimate-cost",
          args: options,
        },
        () => {}
      );
    }
  );

  // Cancel generation
  ipcMain.handle(
    "ai-pipeline:cancel",
    async (
      _event: IpcMainInvokeEvent,
      sessionId: string
    ): Promise<{ success: boolean }> => {
      if (!pipelineManager) {
        return { success: false };
      }
      return { success: pipelineManager.cancel(sessionId) };
    }
  );

  // Refresh environment detection
  ipcMain.handle("ai-pipeline:refresh", async (): Promise<PipelineStatus> => {
    if (!pipelineManager) {
      return {
        available: false,
        version: null,
        source: "unavailable",
        compatible: false,
        features: {},
        error: "Pipeline manager not initialized",
      };
    }
    pipelineManager.refreshEnvironment();
    return pipelineManager.getStatus();
  });

  console.log("[AI Pipeline] IPC handlers registered");
}

/**
 * Cleanup AI Pipeline resources
 */
export function cleanupAIPipeline(): void {
  pipelineManager?.cancelAll();
}

// Cleanup on app quit
app.on("before-quit", () => {
  cleanupAIPipeline();
});
