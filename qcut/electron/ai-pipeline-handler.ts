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
import { getDecryptedApiKeys } from "./api-key-handler.js";
import { importMediaFile } from "./claude/claude-media-handler.js";

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

const OUTPUT_FILE_EXTENSIONS_PATTERN =
  "(?:mp4|png|jpg|jpeg|wav|mp3|webm|gif|mov|mkv|m4v)";
const OUTPUT_FILE_REGEX = new RegExp(
  `\\.${OUTPUT_FILE_EXTENSIONS_PATTERN}$`,
  "i"
);

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
      error: this.getUnavailableErrorMessage(),
    };
  }

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
        outputDir = path.join(app.getPath("temp"), "qcut", "aicp-output", sessionId);
      }

      fs.mkdirSync(outputDir, { recursive: true });
      return outputDir;
    } catch (error) {
      console.warn("[AI Pipeline] Failed to prepare output directory:", error);
      return options.outputDir || null;
    }
  }

  private collectOutputFiles({
    outputDir,
  }: {
    outputDir: string;
  }): Map<string, number> {
    const files = new Map<string, number>();

    try {
      const pendingDirectories = [outputDir];

      while (pendingDirectories.length > 0) {
        const currentDir = pendingDirectories.pop();
        if (!currentDir) {
          continue;
        }

        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            pendingDirectories.push(fullPath);
            continue;
          }

          let stat: fs.Stats;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          files.set(fullPath, stat.mtimeMs);
        }
      }
    } catch (error) {
      console.warn("[AI Pipeline] Failed to collect output files:", error);
    }

    return files;
  }

  private captureOutputSnapshot({
    outputDir,
  }: {
    outputDir: string | null;
  }): Map<string, number> {
    try {
      if (!outputDir) {
        return new Map<string, number>();
      }
      return this.collectOutputFiles({ outputDir });
    } catch (error) {
      console.warn("[AI Pipeline] Failed to capture output snapshot:", error);
      return new Map<string, number>();
    }
  }

  private normalizeOutputPath({
    rawPath,
    outputDir,
  }: {
    rawPath: string;
    outputDir: string | null;
  }): string | null {
    try {
      const trimmedPath = rawPath.trim().replace(/^["']+|["']+$/g, "");
      if (!trimmedPath) {
        return null;
      }

      const likelyAbsolutePath =
        path.isAbsolute(trimmedPath) || /^[A-Za-z]:\\/.test(trimmedPath);
      const normalizedPath = likelyAbsolutePath
        ? path.normalize(trimmedPath)
        : outputDir
          ? path.resolve(outputDir, trimmedPath)
          : path.resolve(trimmedPath);

      if (!OUTPUT_FILE_REGEX.test(normalizedPath)) {
        return null;
      }

      if (!fs.existsSync(normalizedPath)) {
        return null;
      }

      return normalizedPath;
    } catch (error) {
      console.warn("[AI Pipeline] Failed to normalize output path:", error);
      return null;
    }
  }

  private dedupePaths({ paths }: { paths: string[] }): string[] {
    try {
      const uniquePaths = new Set<string>();
      for (const candidatePath of paths) {
        if (!candidatePath) {
          continue;
        }
        uniquePaths.add(candidatePath);
      }
      return Array.from(uniquePaths);
    } catch (error) {
      console.warn("[AI Pipeline] Failed to de-dupe output paths:", error);
      return [];
    }
  }

  private extractOutputPathsFromText({
    text,
    outputDir,
  }: {
    text: string;
    outputDir: string | null;
  }): string[] {
    const outputPaths: string[] = [];

    try {
      const labelledPattern = new RegExp(
        `(?:Output|Saved|Created|File|Path):\\s*([^\\n\\r]+?\\.${OUTPUT_FILE_EXTENSIONS_PATTERN})`,
        "gi"
      );
      const absolutePathPattern = new RegExp(
        `((?:[A-Za-z]:\\\\|/)[^\\n\\r\"']+?\\.${OUTPUT_FILE_EXTENSIONS_PATTERN})`,
        "g"
      );

      for (const match of text.matchAll(labelledPattern)) {
        const normalizedPath = this.normalizeOutputPath({
          rawPath: match[1],
          outputDir,
        });
        if (normalizedPath) {
          outputPaths.push(normalizedPath);
        }
      }

      for (const match of text.matchAll(absolutePathPattern)) {
        const normalizedPath = this.normalizeOutputPath({
          rawPath: match[1],
          outputDir,
        });
        if (normalizedPath) {
          outputPaths.push(normalizedPath);
        }
      }
    } catch (error) {
      console.warn("[AI Pipeline] Failed to parse output paths from text:", error);
    }

    return this.dedupePaths({ paths: outputPaths });
  }

  private extractOutputPathsFromJson({
    jsonData,
    outputDir,
  }: {
    jsonData: unknown;
    outputDir: string | null;
  }): string[] {
    const resolvedPaths: string[] = [];

    try {
      const pendingValues: unknown[] = [jsonData];
      const visitedObjects = new Set<unknown>();

      while (pendingValues.length > 0) {
        const currentValue = pendingValues.shift();
        if (!currentValue) {
          continue;
        }

        if (typeof currentValue === "string") {
          const normalizedPath = this.normalizeOutputPath({
            rawPath: currentValue,
            outputDir,
          });
          if (normalizedPath) {
            resolvedPaths.push(normalizedPath);
          }
          continue;
        }

        if (Array.isArray(currentValue)) {
          for (const item of currentValue) {
            pendingValues.push(item);
          }
          continue;
        }

        if (typeof currentValue !== "object") {
          continue;
        }

        if (visitedObjects.has(currentValue)) {
          continue;
        }
        visitedObjects.add(currentValue);

        const objectValue = currentValue as Record<string, unknown>;
        for (const value of Object.values(objectValue)) {
          pendingValues.push(value);
        }
      }
    } catch (error) {
      console.warn("[AI Pipeline] Failed to parse output paths from JSON:", error);
    }

    return this.dedupePaths({ paths: resolvedPaths });
  }

  private recoverOutputPathsFromDirectory({
    outputDir,
    outputSnapshot,
  }: {
    outputDir: string | null;
    outputSnapshot: Map<string, number>;
  }): string[] {
    try {
      if (!outputDir) {
        return [];
      }

      const afterRunFiles = this.collectOutputFiles({ outputDir });
      const changedFiles: Array<{ filePath: string; mtimeMs: number }> = [];

      for (const [filePath, mtimeMs] of afterRunFiles) {
        if (!OUTPUT_FILE_REGEX.test(filePath)) {
          continue;
        }

        const previousMtime = outputSnapshot.get(filePath);
        if (previousMtime === undefined || previousMtime < mtimeMs) {
          changedFiles.push({ filePath, mtimeMs });
        }
      }

      changedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return changedFiles.map((entry) => entry.filePath);
    } catch (error) {
      console.warn("[AI Pipeline] Failed to recover outputs from directory:", error);
      return [];
    }
  }

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

  private classifyErrorCode({
    errorMessage,
  }: {
    errorMessage: string;
  }): string {
    try {
      const normalizedMessage = errorMessage.toLowerCase();

      if (
        normalizedMessage.includes("fal_key") ||
        normalizedMessage.includes("fal api key") ||
        normalizedMessage.includes("api key not configured")
      ) {
        return "missing_key";
      }

      if (
        normalizedMessage.includes("bundled binary") ||
        normalizedMessage.includes("not available")
      ) {
        return "binary_missing";
      }

      if (normalizedMessage.includes("timed out")) {
        return "generation_failed";
      }

      if (normalizedMessage.includes("import")) {
        return "import_failed";
      }

      return "generation_failed";
    } catch (error) {
      console.warn("[AI Pipeline] Failed to classify error:", error);
      return "generation_failed";
    }
  }

  private inferProjectIdFromPath({
    filePath,
  }: {
    filePath: string;
    }): string | null {
    try {
      const normalizedPath = filePath.replace(/\\\\/g, "/");
      const projectMatch = normalizedPath.match(/\/QCut\/Projects\/([^/]+)/);
      if (!projectMatch || !projectMatch[1]) {
        return null;
      }
      return projectMatch[1];
    } catch (error) {
      console.warn("[AI Pipeline] Failed to infer project ID:", error);
      return null;
    }
  }

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
        options.projectId || this.inferProjectIdFromPath({ filePath: result.outputPath });
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
      console.error("[AI Pipeline] Failed to auto-import generated media:", error);
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

    if (this.shouldUseJsonOutput({ command: options.command, args: options.args })) {
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

    const outputSnapshot = this.captureOutputSnapshot({ outputDir });
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
                console.warn("[AI Pipeline] Failed to parse RESULT payload:", error);
              }
            }

            const trimmedOutput = stdout.trim();
            if (!parsedResult && (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("["))) {
              try {
                parsedResult = JSON.parse(trimmedOutput);
              } catch {
                parsedResult = null;
              }
            }

            const outputCandidates: string[] = [];
            if (parsedResult) {
              outputCandidates.push(
                ...this.extractOutputPathsFromJson({
                  jsonData: parsedResult,
                  outputDir,
                })
              );
            }

            outputCandidates.push(
              ...this.extractOutputPathsFromText({
                text: `${stdout}\n${stderr}`,
                outputDir,
              })
            );
            outputCandidates.push(
              ...this.recoverOutputPathsFromDirectory({
                outputDir,
                outputSnapshot,
              })
            );

            const dedupedOutputPaths = this.dedupePaths({ paths: outputCandidates });

            let successResult: PipelineResult = {
              success: true,
              duration,
            };

            if (parsedResult) {
              if (typeof parsedResult === "object" && !Array.isArray(parsedResult)) {
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
              options: { ...options, outputDir: outputDir || options.outputDir },
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
            errorCode: this.classifyErrorCode({ errorMessage }),
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
            errorCode: this.classifyErrorCode({ errorMessage: err.message }),
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
      _event: IpcMainInvokeEvent,
      options: GenerateOptions
    ): Promise<PipelineResult> => {
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
        const status = await pipelineManager.getStatus();
        return { success: false, error: status.error || "AI Pipeline not available" };
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
  ipcMain.handle(
    "ai-pipeline:list-models",
    async (): Promise<PipelineResult> => {
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
        const status = await pipelineManager.getStatus();
        return { success: false, error: status.error || "AI Pipeline not available" };
      }

      return pipelineManager.execute(
        { command: "list-models", args: {} },
        () => {} // No progress for list
      );
    }
  );

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
        const status = await pipelineManager.getStatus();
        return { success: false, error: status.error || "AI Pipeline not available" };
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
