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
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getBinaryManager, BinaryManager } from "./binary-manager.js";
import { getDecryptedApiKeys } from "./api-key-handler.js";
import { importMediaFile } from "./claude/claude-media-handler.js";
import {
  captureOutputSnapshot,
  classifyErrorCode,
  dedupePaths,
  extractOutputPathsFromJson,
  extractOutputPathsFromText,
  inferProjectIdFromPath,
  recoverOutputPathsFromDirectory,
} from "./ai-pipeline-output.js";

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
  projectId?: string;
  autoImport?: boolean;
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
  errorCode?: string;
  duration?: number;
  cost?: number;
  models?: string[];
  data?: unknown;
  mediaId?: string;
  importedPath?: string;
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

export class AIPipelineManager {
  private config: PipelineConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private binaryManager: BinaryManager;
  private initialization: Promise<void> | null = null;

  constructor() {
    this.binaryManager = getBinaryManager();
    this.config = this.getFallbackConfig();
    this.initialization = this.loadEnvironment();
  }

  /** Return a safe default config when environment detection fails. */
  private getFallbackConfig(): PipelineConfig {
    return { useBundledBinary: false };
  }

  /** Load binary manifest and detect the pipeline environment. */
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

  /** Ensure environment initialization has completed before proceeding. */
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

      if (app.isPackaged) {
        console.warn(
          "[AI Pipeline] Packaged mode requires bundled AICP binary; skipping system/Python fallbacks"
        );
        return this.getFallbackConfig();
      }

      const commandTimeoutMs = 5000;
      const systemVersion = await this.getVersionFromCommand({
        command: "aicp --version",
        label: "system aicp",
        timeoutMs: commandTimeoutMs,
      });
      if (systemVersion) {
        return {
          useBundledBinary: false,
          binaryPath: "aicp",
          version: systemVersion,
        };
      }

      const pythonVersion = await this.getVersionFromCommand({
        command: "python -m ai_content_pipeline --version",
        label: "Python module",
        timeoutMs: commandTimeoutMs,
      });
      if (pythonVersion) {
        return {
          useBundledBinary: false,
          pythonPath: "python",
          version: pythonVersion,
        };
      }

      if (process.platform !== "win32") {
        const python3Version = await this.getVersionFromCommand({
          command: "python3 -m ai_content_pipeline --version",
          label: "Python3 module",
          timeoutMs: commandTimeoutMs,
        });
        if (python3Version) {
          return {
            useBundledBinary: false,
            pythonPath: "python3",
            version: python3Version,
          };
        }
      }
    } catch (error) {
      console.error("[AI Pipeline] Failed to detect environment:", error);
    }

    console.warn("[AI Pipeline] No AI pipeline binary or Python module found");
    return this.getFallbackConfig();
  }

  /** Check if the bundled AICP binary is available and compatible. */
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
      console.log(
        "[AI Pipeline] Bundled binary not found, trying fallbacks..."
      );
    } else if (!status.compatible) {
      console.warn(
        `[AI Pipeline] Bundled binary v${status.version} not compatible with QCut v${app.getVersion()}`
      );
    }

    return null;
  }

  /** Run a version command and return the output, or null on failure. */
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

  /** Execute a shell command with timeout and return stdout. */
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
      error: this.getUnavailableErrorMessage(),
    };
  }

  /** Build a user-facing error message when the pipeline is unavailable. */
  private getUnavailableErrorMessage(): string {
    try {
      if (app.isPackaged) {
        return (
          "AI Content Pipeline is not available. " +
          "The bundled binary was not found or failed validation. " +
          "Please reinstall QCut or contact support."
        );
      }

      return (
        "AI Pipeline binary not found. Install aicp or the " +
        "ai_content_pipeline Python package for development."
      );
    } catch (error) {
      console.warn(
        "[AI Pipeline] Failed to build unavailable message, using fallback:",
        error
      );
      return "AI Pipeline not available";
    }
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

  /** Get execution timeout from env or default (10 minutes). */
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
      return {
        cmd: this.config.pythonPath,
        baseArgs: ["-m", "ai_content_pipeline"],
      };
    }
    throw new Error("AI Pipeline not available");
  }

  /** Generate a unique session ID for pipeline execution tracking. */
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

  /** Determine whether to request JSON output from the pipeline binary. */
  private shouldUseJsonOutput({
    command,
    args,
  }: {
    command: GenerateOptions["command"];
    args: GenerateOptions["args"];
  }): boolean {
    try {
      if (args["no-json"]) {
        return false;
      }
      return command !== "list-models";
    } catch (error) {
      console.warn("[AI Pipeline] Failed to decide JSON output flag:", error);
      return true;
    }
  }

  /** Check if the given command supports an --output-dir flag. */
  private commandSupportsOutputDir({
    command,
  }: {
    command: GenerateOptions["command"];
  }): boolean {
    try {
      return (
        command === "generate-image" ||
        command === "create-video" ||
        command === "generate-avatar" ||
        command === "run-pipeline"
      );
    } catch (error) {
      console.warn("[AI Pipeline] Failed to check output-dir support:", error);
      return false;
    }
  }

  /** Check if the given command requires a FAL API key to run. */
  private commandRequiresFalKey({
    command,
  }: {
    command: GenerateOptions["command"];
  }): boolean {
    try {
      return (
        command === "generate-image" ||
        command === "create-video" ||
        command === "generate-avatar" ||
        command === "run-pipeline"
      );
    } catch (error) {
      console.warn("[AI Pipeline] Failed to check key requirement:", error);
      return false;
    }
  }

  /** Resolve and create the output directory for a pipeline run. */
  private resolveOutputDirectory({
    options,
    sessionId,
  }: {
    options: GenerateOptions;
    sessionId: string;
  }): string | null {
    try {
      if (!this.commandSupportsOutputDir({ command: options.command })) {
        return null;
      }

      let outputDir = options.outputDir;
      if (!outputDir) {
        outputDir = path.join(
          app.getPath("temp"),
          "qcut",
          "aicp-output",
          sessionId
        );
      }

      fs.mkdirSync(outputDir, { recursive: true });
      return outputDir;
    } catch (error) {
      console.warn("[AI Pipeline] Failed to prepare output directory:", error);
      return options.outputDir || null;
    }
  }

  /** Build the environment variables for spawning the pipeline process, including decrypted API keys. */
  private async buildSpawnEnvironment(): Promise<NodeJS.ProcessEnv> {
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

    try {
      const storedKeys = await getDecryptedApiKeys();
      if (storedKeys.falApiKey) {
        spawnEnv.FAL_KEY = storedKeys.falApiKey;
        spawnEnv.FAL_API_KEY = storedKeys.falApiKey;
      }
      if (storedKeys.geminiApiKey) {
        spawnEnv.GEMINI_API_KEY = storedKeys.geminiApiKey;
      }
    } catch (error) {
      console.warn("[AI Pipeline] Failed to load stored API keys:", error);
    }

    return spawnEnv;
  }

  /** Auto-import generated output files into the QCut project if enabled. */
  private async maybeAutoImportOutput({
    options,
    result,
  }: {
    options: GenerateOptions;
    result: PipelineResult;
  }): Promise<PipelineResult> {
    try {
      if (!result.success || !result.outputPath) {
        return result;
      }

      if (options.autoImport === false) {
        return result;
      }

      const projectId =
        options.projectId ||
        inferProjectIdFromPath({ filePath: result.outputPath });
      if (!projectId) {
        return result;
      }

      const importedMedia = await importMediaFile(projectId, result.outputPath);
      if (importedMedia) {
        return {
          ...result,
          mediaId: importedMedia.id,
          importedPath: importedMedia.path,
        };
      }

      return {
        ...result,
        success: false,
        errorCode: "import_failed",
        error:
          "Generation succeeded but import failed. Try importing the output file manually from the generated path.",
      };
    } catch (error) {
      console.error(
        "[AI Pipeline] Failed to auto-import generated media:",
        error
      );
      return {
        ...result,
        success: false,
        errorCode: "import_failed",
        error:
          "Generation succeeded but media import failed due to an unexpected error.",
      };
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
      return {
        success: false,
        error: this.getUnavailableErrorMessage(),
        errorCode: "binary_missing",
      };
    }

    const { cmd, baseArgs } = this.getCommand();
    const sessionId = options.sessionId || this.buildSessionId();
    const args = [...baseArgs, options.command];

    if (
      this.shouldUseJsonOutput({ command: options.command, args: options.args })
    ) {
      args.push("--json");
    }

    for (const [key, value] of Object.entries(options.args)) {
      if (key === "no-json") {
        continue;
      }

      if (value === true) {
        args.push(`--${key}`);
        continue;
      }

      if (value !== false && value !== undefined && value !== "") {
        args.push(`--${key}`, String(value));
      }
    }

    const outputDir = this.resolveOutputDirectory({ options, sessionId });
    if (outputDir) {
      args.push("--output-dir", outputDir);
    }

    const outputSnapshot = captureOutputSnapshot({ outputDir });
    const spawnEnv = await this.buildSpawnEnvironment();

    if (
      this.commandRequiresFalKey({ command: options.command }) &&
      !spawnEnv.FAL_KEY
    ) {
      return {
        success: false,
        errorCode: "missing_key",
        error:
          "FAL API key not configured. Go to Editor -> Settings -> API Keys and set FAL API Key.",
      };
    }

    return new Promise((resolve) => {
      console.log("[AI Pipeline] Executing:", cmd, args.join(" "));

      const proc = spawn(cmd, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: spawnEnv,
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

      proc.on("close", async (code: number | null) => {
        this.activeProcesses.delete(sessionId);
        const duration = (Date.now() - startTime) / 1000;

        if (code === 0) {
          try {
            let parsedResult: unknown = null;

            const resultMatch = stdout.match(/RESULT:(.+)$/m);
            if (resultMatch) {
              try {
                parsedResult = JSON.parse(resultMatch[1]);
              } catch (error) {
                console.warn(
                  "[AI Pipeline] Failed to parse RESULT payload:",
                  error
                );
              }
            }

            const trimmedOutput = stdout.trim();
            if (
              !parsedResult &&
              (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("["))
            ) {
              try {
                parsedResult = JSON.parse(trimmedOutput);
              } catch {
                parsedResult = null;
              }
            }

            const outputCandidates: string[] = [];
            if (parsedResult) {
              outputCandidates.push(
                ...extractOutputPathsFromJson({
                  jsonData: parsedResult,
                  outputDir,
                })
              );
            }

            outputCandidates.push(
              ...extractOutputPathsFromText({
                text: `${stdout}\n${stderr}`,
                outputDir,
              })
            );
            outputCandidates.push(
              ...recoverOutputPathsFromDirectory({
                outputDir,
                outputSnapshot,
              })
            );

            const dedupedOutputPaths = dedupePaths({
              paths: outputCandidates,
            });

            let successResult: PipelineResult = {
              success: true,
              duration,
            };

            if (parsedResult) {
              if (
                typeof parsedResult === "object" &&
                !Array.isArray(parsedResult)
              ) {
                const pipelinePayload = parsedResult as Partial<PipelineResult>;
                successResult = {
                  ...successResult,
                  ...pipelinePayload,
                  success: true,
                  duration,
                };
              } else {
                successResult.data = parsedResult;
              }
            }

            if (dedupedOutputPaths.length > 0) {
              successResult.outputPath = dedupedOutputPaths[0];
              successResult.outputPaths = dedupedOutputPaths;
            }

            if (
              this.commandSupportsOutputDir({ command: options.command }) &&
              !successResult.outputPath
            ) {
              resolveOnce({
                result: {
                  success: false,
                  duration,
                  errorCode: "output_unresolved",
                  error:
                    "Generation finished but the output file could not be located.",
                },
              });
              return;
            }

            const importedResult = await this.maybeAutoImportOutput({
              options: {
                ...options,
                outputDir: outputDir || options.outputDir,
              },
              result: successResult,
            });
            resolveOnce({ result: importedResult });
          } catch (parseError) {
            console.warn("[AI Pipeline] Failed to parse output:", parseError);
            resolveOnce({
              result: {
                success: false,
                duration,
                errorCode: "generation_failed",
                error: "AI generation completed with unreadable output.",
              },
            });
          }
          return;
        }

        const errorMessage =
          stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
        console.error("[AI Pipeline] Failed:", errorMessage);
        resolveOnce({
          result: {
            success: false,
            error: errorMessage,
            errorCode: classifyErrorCode({ errorMessage }),
            duration,
          },
        });
      });

      proc.on("error", (err: Error) => {
        this.activeProcesses.delete(sessionId);
        console.error("[AI Pipeline] Process error:", err);
        resolveOnce({
          result: {
            success: false,
            error: err.message,
            errorCode: classifyErrorCode({ errorMessage: err.message }),
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
