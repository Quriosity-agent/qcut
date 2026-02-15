import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from "electron";
import {
  AIPipelineManager,
  GenerateOptions,
  PipelineResult,
  PipelineStatus,
} from "./ai-pipeline-handler.js";

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
        return {
          success: false,
          error: status.error || "AI Pipeline not available",
        };
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
    ): Promise<PipelineResult> => {
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
