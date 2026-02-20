/**
 * Claude Project API Handler
 * Provides project settings read/write capabilities for Claude Code integration
 */

import {
  ipcMain,
  BrowserWindow,
  IpcMainInvokeEvent,
  IpcMainEvent,
} from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getProjectsBasePath,
  getProjectSettingsPath,
} from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import type { ProjectSettings, ProjectStats } from "../types/claude-api";

const HANDLER_NAME = "Project";

/** Parse an "W:H" aspect ratio string into width/height numbers, or null if invalid. */
function parseAspectRatio({
  aspectRatio,
}: {
  aspectRatio: string;
}): { width: number; height: number } | null {
  try {
    const [widthRaw, heightRaw] = aspectRatio.split(":");
    const width = Number.parseFloat(widthRaw);
    const height = Number.parseFloat(heightRaw);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }

    return { width, height };
  } catch {
    return null;
  }
}

/** Return a ProjectStats object with all counters at zero. */
function getEmptyStats(): ProjectStats {
  return {
    totalDuration: 0,
    mediaCount: { video: 0, audio: 0, image: 0 },
    trackCount: 0,
    elementCount: 0,
    lastModified: Date.now(),
    fileSize: 0,
  };
}

/**
 * List all projects that have a project.qcut file on disk.
 * Returns project IDs and basic settings for each.
 */
export async function listProjects(): Promise<
  Array<{ id: string; name: string; updatedAt?: string }>
> {
  const basePath = getProjectsBasePath();
  let entries: string[];
  try {
    entries = await fs.readdir(basePath);
  } catch {
    return [];
  }

  const projects: Array<{ id: string; name: string; updatedAt?: string }> = [];
  for (const entry of entries) {
    const settingsFile = path.join(basePath, entry, "project.qcut");
    try {
      const content = await fs.readFile(settingsFile, "utf-8");
      const data = JSON.parse(content);
      projects.push({
        id: entry,
        name: data.name || "Untitled",
        updatedAt: data.updatedAt,
      });
    } catch {
      // Skip directories without a valid project.qcut
    }
  }

  return projects;
}

/**
 * Get project settings from disk
 */
export async function getProjectSettings(
  projectId: string
): Promise<ProjectSettings> {
  claudeLog.info(HANDLER_NAME, `Getting settings for project: ${projectId}`);

  const settingsPath = getProjectSettingsPath(projectId);

  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const project = JSON.parse(content);

    const width = project.canvasSize?.width || project.width || 1920;
    const height = project.canvasSize?.height || project.height || 1080;

    return {
      name: project.name || "Untitled",
      width,
      height,
      fps: project.fps || 30,
      aspectRatio: project.aspectRatio || `${width}:${height}`,
      backgroundColor: project.backgroundColor || "#000000",
      exportFormat: project.exportFormat || "mp4",
      exportQuality: project.exportQuality || "high",
    };
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to read project settings:", error);
    throw new Error(`Failed to read project: ${projectId}`);
  }
}

/**
 * Update project settings on disk.
 * Returns the updated settings but does NOT notify the renderer — the IPC wrapper handles that.
 */
export async function updateProjectSettings(
  projectId: string,
  settings: Partial<ProjectSettings>
): Promise<void> {
  claudeLog.info(HANDLER_NAME, `Updating settings for project: ${projectId}`);

  const settingsPath = getProjectSettingsPath(projectId);

  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const project = JSON.parse(content);

    if (settings.name !== undefined) project.name = settings.name;
    if (settings.fps !== undefined) project.fps = settings.fps;
    if (settings.backgroundColor !== undefined)
      project.backgroundColor = settings.backgroundColor;
    if (settings.exportFormat !== undefined)
      project.exportFormat = settings.exportFormat;
    if (settings.exportQuality !== undefined)
      project.exportQuality = settings.exportQuality;
    if (settings.aspectRatio !== undefined)
      project.aspectRatio = settings.aspectRatio;

    if (settings.width !== undefined || settings.height !== undefined) {
      if (!project.canvasSize) {
        project.canvasSize = { width: 1920, height: 1080 };
      }
      if (settings.width !== undefined)
        project.canvasSize.width = settings.width;
      if (settings.height !== undefined)
        project.canvasSize.height = settings.height;
    } else if (typeof settings.aspectRatio === "string") {
      const parsedAspectRatio = parseAspectRatio({
        aspectRatio: settings.aspectRatio,
      });
      if (parsedAspectRatio) {
        const currentWidth = project.canvasSize?.width ?? 1920;
        const currentHeight = project.canvasSize?.height ?? 1080;

        if (parsedAspectRatio.width >= parsedAspectRatio.height) {
          const recalculatedHeight = Math.max(
            1,
            Math.round(
              currentWidth *
                (parsedAspectRatio.height / parsedAspectRatio.width)
            )
          );
          project.canvasSize = {
            width: currentWidth,
            height: recalculatedHeight,
          };
        } else {
          const recalculatedWidth = Math.max(
            1,
            Math.round(
              currentHeight *
                (parsedAspectRatio.width / parsedAspectRatio.height)
            )
          );
          project.canvasSize = {
            width: recalculatedWidth,
            height: currentHeight,
          };
        }
      }
    }

    project.updatedAt = new Date().toISOString();

    await fs.writeFile(settingsPath, JSON.stringify(project, null, 2), "utf-8");
    const broadcastSettings = project.canvasSize
      ? { ...settings, canvasSize: project.canvasSize }
      : settings;
    broadcastProjectSettingsUpdate({ projectId, settings: broadcastSettings });

    claudeLog.info(HANDLER_NAME, `Successfully updated project: ${projectId}`);
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to update project settings:", error);
    throw error;
  }
}

/** Broadcast updated project settings to all renderer windows. */
export function broadcastProjectSettingsUpdate({
  projectId,
  settings,
}: {
  projectId: string;
  settings: Partial<ProjectSettings>;
}): void {
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      try {
        win.webContents.send("claude:project:updated", projectId, settings);
      } catch {
        // Ignore individual window dispatch failures.
      }
    }
  } catch (error) {
    claudeLog.warn(
      HANDLER_NAME,
      "Failed to broadcast project settings update:",
      error
    );
  }
}

/**
 * Get project stats from renderer via IPC.
 * Requires a BrowserWindow to communicate with.
 */
export async function getProjectStats(
  win: BrowserWindow,
  projectId: string
): Promise<ProjectStats> {
  claudeLog.info(HANDLER_NAME, `Getting stats for project: ${projectId}`);

  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${win.webContents.id}`;

    const handler = (
      responseEvent: IpcMainEvent,
      stats: ProjectStats,
      responseId?: string
    ) => {
      if (
        responseEvent.sender.id !== win.webContents.id ||
        responseId !== requestId
      ) {
        return;
      }
      clearTimeout(timeout);
      ipcMain.removeListener("claude:project:statsResponse", handler);
      resolve(stats);
    };

    const timeout = setTimeout(() => {
      ipcMain.removeListener("claude:project:statsResponse", handler);
      claudeLog.warn(
        HANDLER_NAME,
        "Timeout waiting for stats, returning empty"
      );
      resolve(getEmptyStats());
    }, 3000);

    try {
      ipcMain.on("claude:project:statsResponse", handler);
      win.webContents.send("claude:project:statsRequest", {
        projectId,
        requestId,
      });
    } catch (error) {
      clearTimeout(timeout);
      ipcMain.removeListener("claude:project:statsResponse", handler);
      claudeLog.error(HANDLER_NAME, "Failed to request stats:", error);
      resolve(getEmptyStats());
    }
  });
}

export { getEmptyStats };

/** Register Claude project IPC handlers for settings and stats. */
export function setupClaudeProjectIPC(): void {
  claudeLog.info(HANDLER_NAME, "Setting up Project IPC handlers...");

  ipcMain.handle(
    "claude:project:getSettings",
    async (_event: IpcMainInvokeEvent, projectId: string) =>
      getProjectSettings(projectId)
  );

  ipcMain.handle(
    "claude:project:updateSettings",
    async (
      _event: IpcMainInvokeEvent,
      projectId: string,
      settings: Partial<ProjectSettings>
    ) => {
      await updateProjectSettings(projectId, settings);
    }
  );

  ipcMain.handle(
    "claude:project:getStats",
    async (event: IpcMainInvokeEvent, projectId: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return getEmptyStats();
      }
      return getProjectStats(win, projectId);
    }
  );

  claudeLog.info(HANDLER_NAME, "Project IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
  setupClaudeProjectIPC,
  listProjects,
  getProjectSettings,
  updateProjectSettings,
  broadcastProjectSettingsUpdate,
  getProjectStats,
  getEmptyStats,
};
