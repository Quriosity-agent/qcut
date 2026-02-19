import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from "electron";
import {
  NativePipelineManager,
  type GenerateOptions,
  type PipelineResult,
  type PipelineStatus,
} from "./native-pipeline/index.js";
import {
  AIPipelineManager,
  type GenerateOptions as LegacyGenerateOptions,
  type PipelineResult as LegacyPipelineResult,
  type PipelineStatus as LegacyPipelineStatus,
} from "./ai-pipeline-handler.js";

// Feature flag for gradual rollout — set QCUT_NATIVE_PIPELINE=false to use legacy binary
const USE_NATIVE_PIPELINE = process.env.QCUT_NATIVE_PIPELINE !== "false";

type PipelineManagerUnion = NativePipelineManager | AIPipelineManager;

let pipelineManager: PipelineManagerUnion | null = null;

const UNAVAILABLE_STATUS: PipelineStatus | LegacyPipelineStatus = {
  available: false,
  version: null,
  source: "unavailable" as const,
  compatible: false,
  features: {},
  error: "Pipeline manager not initialized",
};

/** Get the current main window for sending progress updates. */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Setup AI Pipeline IPC handlers
 */
export function setupAIPipelineIPC(): void {
  if (USE_NATIVE_PIPELINE) {
    pipelineManager = new NativePipelineManager();
    console.log("[AI Pipeline] Using native TypeScript pipeline");
  } else {
    pipelineManager = new AIPipelineManager();
    console.log("[AI Pipeline] Using legacy binary pipeline");
  }

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
  ipcMain.handle(
    "ai-pipeline:status",
    async (): Promise<PipelineStatus | LegacyPipelineStatus> => {
      if (!pipelineManager) {
        return UNAVAILABLE_STATUS;
      }
      return pipelineManager.getStatus();
    }
  );

  // Generate content (image, video, avatar)
  ipcMain.handle(
    "ai-pipeline:generate",
    async (
      _event: IpcMainInvokeEvent,
      options: GenerateOptions
    ): Promise<PipelineResult | LegacyPipelineResult> => {
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
        const status = await pipelineManager.getStatus();
        return {
          success: false,
          error: status.error || "AI Pipeline not available",
        };
      }

      // Generate sessionId if not provided to ensure correlation
      const sessionId = options.sessionId ?? `ai-${Date.now()}`;
      // Type assertion needed: native pipeline accepts vimax commands,
      // legacy pipeline won't receive them (filtered by renderer)
      return pipelineManager.execute(
        { ...options, sessionId } as never,
        (progress) => {
          // Send progress to renderer
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("ai-pipeline:progress", {
              sessionId,
              ...progress,
            });
          }
        }
      );
    }
  );

  // List available models
  ipcMain.handle(
    "ai-pipeline:list-models",
    async (): Promise<PipelineResult | LegacyPipelineResult> => {
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
        const status = await pipelineManager.getStatus();
        return {
          success: false,
          error: status.error || "AI Pipeline not available",
        };
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
    ): Promise<PipelineResult | LegacyPipelineResult> => {
      if (!pipelineManager) {
        return { success: false, error: "Pipeline manager not initialized" };
      }
      const isAvailable = await pipelineManager.isAvailable();
      if (!isAvailable) {
        const status = await pipelineManager.getStatus();
        return {
          success: false,
          error: status.error || "AI Pipeline not available",
        };
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
  ipcMain.handle(
    "ai-pipeline:refresh",
    async (): Promise<PipelineStatus | LegacyPipelineStatus> => {
      if (!pipelineManager) {
        return UNAVAILABLE_STATUS;
      }
      await pipelineManager.refreshEnvironment();
      return pipelineManager.getStatus();
    }
  );

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
