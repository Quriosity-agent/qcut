/**
 * AI Pipeline Handler - Electron IPC handler for AI content generation
 *
 * Spawns the aicp CLI binary to generate AI content (images, videos, avatars)
 * following the established FFmpeg handler pattern.
 *
 * @module electron/ai-pipeline-handler
 */
import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
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
  private initialization: Promise<void> | null = null;

  constructor() {
    this.binaryManager = getBinaryManager();
    this.config = this.getFallbackConfig();
    this.initialization = this.loadEnvironment();
  }

  private getFallbackConfig(): PipelineConfig {
    return { useBundledBinary: false };
  }

  private async loadEnvironment(): Promise<void> {
    try {
      this.binaryManager.reloadManifest();
    } catch (error) {
      console.error("[AI Pipeline] Failed to reload manifest:", error);
    }

    try {
      this.config = await this.detectEnvironment();
    } catch (error) {
      console.error("[AI Pipeline] Failed to detect environment:", error);
      this.config = this.getFallbackConfig();
    }
  }

  private async ensureEnvironmentReady(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.loadEnvironment();
    }

    try {
      await this.initialization;
    } catch (error) {
      console.error("[AI Pipeline] Environment initialization failed:", error);
      this.config = this.getFallbackConfig();
    }
  }

  /**
   * Detect available AI pipeline binary/module
   * Priority: Bundled binary > System aicp > Python module
   */
  private async detectEnvironment(): Promise<PipelineConfig> {
    try {
      const bundledConfig = this.getBundledConfig();
      if (bundledConfig) {
        return bundledConfig;
      }

      const commandTimeoutMs = 5000;
      const systemVersion = await this.getVersionFromCommand({
        command: "aicp --version",
        label: "system aicp",
        timeoutMs: commandTimeoutMs,
      });
      if (systemVersion) {
        return { useBundledBinary: false, binaryPath: "aicp", version: systemVersion };
      }

      const pythonVersion = await this.getVersionFromCommand({
        command: "python -m ai_content_pipeline --version",
        label: "Python module",
        timeoutMs: commandTimeoutMs,
      });
      if (pythonVersion) {
        return { useBundledBinary: false, pythonPath: "python", version: pythonVersion };
      }

      if (process.platform !== "win32") {
        const python3Version = await this.getVersionFromCommand({
          command: "python3 -m ai_content_pipeline --version",
          label: "Python3 module",
          timeoutMs: commandTimeoutMs,
        });
        if (python3Version) {
          return { useBundledBinary: false, pythonPath: "python3", version: python3Version };
        }
      }
    } catch (error) {
      console.error("[AI Pipeline] Failed to detect environment:", error);
    }

    console.warn("[AI Pipeline] No AI pipeline binary or Python module found");
    return this.getFallbackConfig();
  }

  private getBundledConfig(): PipelineConfig | null {
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

    if (!status.available) {
      console.log("[AI Pipeline] Bundled binary not found, trying fallbacks...");
    } else if (!status.compatible) {
      console.warn(
        `[AI Pipeline] Bundled binary v${status.version} not compatible with QCut v${app.getVersion()}`
      );
    }

    return null;
  }

  private async getVersionFromCommand({
    command,
    label,
    timeoutMs,
  }: {
    command: string;
    label: string;
    timeoutMs: number;
  }): Promise<string | null> {
    try {
      const output = await this.execCommand({ command, timeoutMs });
      const version = output.trim();
      if (!version) {
        return null;
      }
      console.log(`[AI Pipeline] Using ${label}:`, version);
      return version;
    } catch {
      return null;
    }
  }

  private async execCommand({
    command,
    timeoutMs,
  }: {
    command: string;
    timeoutMs: number;
  }): Promise<string> {
    const result = await execAsync(command, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    const stdout = result.stdout;
    return typeof stdout === "string" ? stdout : String(stdout);
  }

  /**
   * Refresh environment detection (useful after binary installation)
   */
  async refreshEnvironment(): Promise<void> {
    this.initialization = this.loadEnvironment();
    await this.ensureEnvironmentReady();
  }

  /**
   * Check if AI pipeline is available
   */
  async isAvailable(): Promise<boolean> {
    await this.ensureEnvironmentReady();
    return (
      this.config.binaryPath !== undefined ||
      this.config.pythonPath !== undefined
    );
  }

  /**
   * Get detailed status for UI display
   */
  async getStatus(): Promise<PipelineStatus> {
    await this.ensureEnvironmentReady();
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

  private getExecutionTimeoutMs(): number {
    const defaultTimeoutMs = 10 * 60 * 1000;
    const rawTimeout = process.env.QCUT_AICP_TIMEOUT_MS;

    if (!rawTimeout) {
      return defaultTimeoutMs;
    }

    try {
      const parsedTimeout = Number(rawTimeout);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
        console.warn(
          `[AI Pipeline] Invalid QCUT_AICP_TIMEOUT_MS value: "${rawTimeout}", using default`
        );
        return defaultTimeoutMs;
      }
      return parsedTimeout;
    } catch (error) {
      console.warn(
        "[AI Pipeline] Failed to parse QCUT_AICP_TIMEOUT_MS, using default:",
        error
      );
      return defaultTimeoutMs;
    }
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

  private buildSessionId(): string {
    try {
      return `ai-${randomUUID()}`;
    } catch (error) {
      console.warn(
        "[AI Pipeline] Failed to generate UUID, falling back to timestamp:",
        error
      );
      return `ai-${Date.now()}-${process.pid}`;
    }
  }

  /**
   * Execute an AI pipeline command
   */
  async execute(
    options: GenerateOptions,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> {
    if (!(await this.isAvailable())) {
      return { success: false, error: "AI Pipeline not available" };
    }

    const { cmd, baseArgs } = this.getCommand();
    const sessionId = options.sessionId || this.buildSessionId();

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
      const timeoutMs = this.getExecutionTimeoutMs();
      let isSettled = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const resolveOnce = ({ result }: { result: PipelineResult }): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          resolve(result);
        } catch (error) {
          console.error("[AI Pipeline] Failed to resolve promise:", error);
        }
      };

      const safeKill = ({ signal }: { signal: NodeJS.Signals }): void => {
        try {
          proc.kill(signal);
        } catch (error) {
          console.warn("[AI Pipeline] Failed to kill process:", error);
        }
      };

      timeoutId = setTimeout(() => {
        try {
          if (this.activeProcesses.has(sessionId)) {
            safeKill({ signal: "SIGTERM" });
            this.activeProcesses.delete(sessionId);
          }
          resolveOnce({
            result: {
              success: false,
              error: `Process timed out after ${Math.round(timeoutMs / 1000)}s`,
              duration: (Date.now() - startTime) / 1000,
            },
          });
        } catch (error) {
          console.error("[AI Pipeline] Timeout handler error:", error);
          resolveOnce({
            result: {
              success: false,
              error: "Process timed out",
              duration: (Date.now() - startTime) / 1000,
            },
          });
        }
      }, timeoutMs);

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
              resolveOnce({
                result: {
                  success: true,
                  ...result,
                  duration,
                },
              });
              return;
            }

            // Try to parse entire stdout as JSON
            const trimmedOutput = stdout.trim();
            if (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("[")) {
              try {
                const jsonResult = JSON.parse(trimmedOutput);
                resolveOnce({
                  result: {
                    success: true,
                    data: jsonResult,
                    duration,
                  },
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
              resolveOnce({
                result: {
                  success: true,
                  outputPaths: paths,
                  outputPath: paths[0],
                  duration,
                },
              });
              return;
            }

            // Success with no specific output
            resolveOnce({
              result: {
                success: true,
                duration,
              },
            });
          } catch (parseError) {
            console.warn("[AI Pipeline] Failed to parse output:", parseError);
            resolveOnce({
              result: {
                success: true,
                duration,
              },
            });
          }
        } else {
          const errorMessage =
            stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
          console.error("[AI Pipeline] Failed:", errorMessage);
          resolveOnce({
            result: {
              success: false,
              error: errorMessage,
              duration,
            },
          });
        }
      });

      // Handle process errors
      proc.on("error", (err: Error) => {
        this.activeProcesses.delete(sessionId);
        console.error("[AI Pipeline] Process error:", err);
        resolveOnce({
          result: {
            success: false,
            error: err.message,
          },
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
      const status = await pipelineManager.getStatus();
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
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
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
    if (!pipelineManager) {
      return { success: false, error: "Pipeline manager not initialized" };
    }
    const isAvailable = await pipelineManager.isAvailable();
    if (!isAvailable) {
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
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
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
    await pipelineManager.refreshEnvironment();
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
