/**
 * Claude Timeline API Handler
 * Provides timeline read/write capabilities for Claude Code integration
 */

import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  formatTimeFromSeconds,
  parseTime,
  generateId,
} from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import type {
  ClaudeTimeline,
  ClaudeTrack,
  ClaudeElement,
  ClaudeSplitRequest,
  ClaudeSplitResponse,
  ClaudeMoveRequest,
  ClaudeSelectionItem,
} from "../types/claude-api";

const HANDLER_NAME = "Timeline";

/**
 * Request timeline data from renderer process
 */
export async function requestTimelineFromRenderer(
  win: BrowserWindow,
): Promise<ClaudeTimeline> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener("claude:timeline:response", handler);
      reject(new Error("Timeout waiting for timeline data"));
    }, 5000);

    const handler = (_event: any, timeline: ClaudeTimeline) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(timeline);
    };

    ipcMain.once("claude:timeline:response", handler);
    win.webContents.send("claude:timeline:request");
  });
}

/**
 * Convert Timeline to Markdown format
 */
export function timelineToMarkdown(timeline: ClaudeTimeline): string {
  let md = `# Timeline: ${timeline.name}\n\n`;

  md += "## Project Info\n\n";
  md += "| Property | Value |\n";
  md += "|----------|-------|\n";
  md += `| Duration | ${formatTimeFromSeconds(timeline.duration)} |\n`;
  md += `| Resolution | ${timeline.width}x${timeline.height} |\n`;
  md += `| FPS | ${timeline.fps} |\n`;
  md += `| Tracks | ${timeline.tracks.length} |\n\n`;

  for (const track of timeline.tracks) {
    md += `## Track ${track.index + 1}: ${track.name || track.type}\n\n`;

    if (track.elements.length === 0) {
      md += "*No elements in this track*\n\n";
      continue;
    }

    md += "| ID | Start | End | Duration | Type | Source | Content |\n";
    md += "|----|-------|-----|----------|------|--------|--------|\n";

    for (const element of track.elements) {
      const content = (element.content || element.sourceName || "-").substring(
        0,
        25,
      );
      md += `| \`${element.id.substring(0, 8)}\` | ${formatTimeFromSeconds(element.startTime)} | ${formatTimeFromSeconds(element.endTime)} | ${formatTimeFromSeconds(element.duration)} | ${element.type} | ${element.sourceName || "-"} | ${content} |\n`;
    }
    md += "\n";
  }

  md += "---\n\n";
  md += `*Exported at: ${new Date().toISOString()}*\n`;

  return md;
}

/**
 * Parse Markdown to Timeline
 */
export function markdownToTimeline(md: string): ClaudeTimeline {
  const timeline: ClaudeTimeline = {
    name: "Imported Timeline",
    duration: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
  };

  const nameMatch = md.match(/# Timeline: (.+)/);
  if (nameMatch) {
    timeline.name = nameMatch[1].trim();
  }

  const resMatch = md.match(/Resolution \| (\d+)x(\d+)/);
  if (resMatch) {
    timeline.width = parseInt(resMatch[1]);
    timeline.height = parseInt(resMatch[2]);
  }

  const fpsMatch = md.match(/FPS \| (\d+)/);
  if (fpsMatch) {
    timeline.fps = parseInt(fpsMatch[1]);
  }

  const durationMatch = md.match(/Duration \| (\d+:\d+:\d+)/);
  if (durationMatch) {
    timeline.duration = parseTime(durationMatch[1]);
  }

  // Track/element parsing not implemented - throw to prevent silent data loss
  if (md.includes("## Track")) {
    throw new Error(
      "Markdown track parsing not yet implemented. Use JSON format for full timeline import.",
    );
  }

  claudeLog.warn(
    HANDLER_NAME,
    "Imported markdown contains project metadata only - no tracks parsed",
  );

  return timeline;
}

/**
 * Validate timeline structure
 */
export function validateTimeline(timeline: ClaudeTimeline): void {
  if (!timeline.name) {
    throw new Error("Timeline must have a name");
  }
  if (!timeline.tracks || !Array.isArray(timeline.tracks)) {
    throw new Error("Timeline must have tracks array");
  }
  if (timeline.width <= 0 || timeline.height <= 0) {
    throw new Error("Timeline must have valid dimensions");
  }
  if (timeline.fps <= 0) {
    throw new Error("Timeline must have valid FPS");
  }

  for (const track of timeline.tracks) {
    if (typeof track.index !== "number") {
      throw new Error("Track must have an index");
    }
    if (!Array.isArray(track.elements)) {
      throw new Error("Track must have elements array");
    }

    for (const element of track.elements) {
      if (element.startTime < 0 || element.endTime < element.startTime) {
        throw new Error(`Invalid element timing: ${element.id}`);
      }
    }
  }
}

/**
 * Request a split operation from the renderer and wait for the result
 */
export async function requestSplitFromRenderer(
  win: BrowserWindow,
  elementId: string,
  splitTime: number,
  mode?: string,
): Promise<ClaudeSplitResponse> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const requestId = generateId("req");

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener("claude:timeline:splitElement:response", handler);
      reject(new Error("Timeout waiting for split result"));
    }, 5000);

    const handler = (
      _event: any,
      data: { requestId: string; result: ClaudeSplitResponse },
    ) => {
      if (data.requestId !== requestId || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ipcMain.removeListener("claude:timeline:splitElement:response", handler);
      resolve(data.result);
    };

    ipcMain.on("claude:timeline:splitElement:response", handler);
    win.webContents.send("claude:timeline:splitElement", {
      requestId,
      elementId,
      splitTime,
      mode: mode || "split",
    });
  });
}

/**
 * Request current selection state from the renderer
 */
export async function requestSelectionFromRenderer(
  win: BrowserWindow,
): Promise<ClaudeSelectionItem[]> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const requestId = generateId("req");

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener("claude:timeline:getSelection:response", handler);
      reject(new Error("Timeout waiting for selection data"));
    }, 5000);

    const handler = (
      _event: any,
      data: { requestId: string; elements: ClaudeSelectionItem[] },
    ) => {
      if (data.requestId !== requestId || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ipcMain.removeListener("claude:timeline:getSelection:response", handler);
      resolve(data.elements);
    };

    ipcMain.on("claude:timeline:getSelection:response", handler);
    win.webContents.send("claude:timeline:getSelection", { requestId });
  });
}

/** Register all Claude timeline IPC handlers for export, import, and element manipulation. */
export function setupClaudeTimelineIPC(): void {
  claudeLog.info(HANDLER_NAME, "Setting up Timeline IPC handlers...");

  ipcMain.handle(
    "claude:timeline:export",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      format: "json" | "md",
    ): Promise<string> => {
      claudeLog.info(
        HANDLER_NAME,
        `Exporting timeline for project: ${projectId}, format: ${format}`,
      );

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }

      const timeline = await requestTimelineFromRenderer(win);

      if (format === "md") {
        return timelineToMarkdown(timeline);
      }
      return JSON.stringify(timeline, null, 2);
    },
  );

  ipcMain.handle(
    "claude:timeline:import",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      data: string,
      format: "json" | "md",
    ): Promise<void> => {
      claudeLog.info(
        HANDLER_NAME,
        `Importing timeline for project: ${projectId}, format: ${format}`,
      );

      let timeline: ClaudeTimeline;

      try {
        if (format === "md") {
          timeline = markdownToTimeline(data);
        } else {
          timeline = JSON.parse(data);
        }
        validateTimeline(timeline);
      } catch (error) {
        claudeLog.error(HANDLER_NAME, "Invalid timeline payload", error);
        throw new Error("Invalid timeline payload");
      }

      event.sender.send("claude:timeline:apply", timeline);

      claudeLog.info(HANDLER_NAME, "Timeline import sent to renderer");
    },
  );

  ipcMain.handle(
    "claude:timeline:addElement",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      element: Partial<ClaudeElement>,
    ): Promise<string> => {
      claudeLog.info(HANDLER_NAME, `Adding element to project: ${projectId}`);
      const elementId = element.id || generateId("element");
      event.sender.send("claude:timeline:addElement", {
        ...element,
        id: elementId,
      });
      return elementId;
    },
  );

  ipcMain.handle(
    "claude:timeline:updateElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      changes: Partial<ClaudeElement>,
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Updating element: ${elementId}`);
      event.sender.send("claude:timeline:updateElement", {
        elementId,
        changes,
      });
    },
  );

  ipcMain.handle(
    "claude:timeline:removeElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Removing element: ${elementId}`);
      event.sender.send("claude:timeline:removeElement", elementId);
    },
  );

  // ---- Split element (request-response to get secondElementId) ----
  ipcMain.handle(
    "claude:timeline:splitElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      splitTime: number,
      mode?: "split" | "keepLeft" | "keepRight",
    ): Promise<ClaudeSplitResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Splitting element: ${elementId} at ${splitTime}s (mode: ${mode || "split"})`,
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error("Window not found");
      return requestSplitFromRenderer(win, elementId, splitTime, mode);
    },
  );

  // ---- Move element (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:moveElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      toTrackId: string,
      newStartTime?: number,
    ): Promise<void> => {
      claudeLog.info(
        HANDLER_NAME,
        `Moving element: ${elementId} to track: ${toTrackId}`,
      );
      event.sender.send("claude:timeline:moveElement", {
        elementId,
        toTrackId,
        newStartTime,
      });
    },
  );

  // ---- Select elements (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:selectElements",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elements: ClaudeSelectionItem[],
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Selecting ${elements.length} element(s)`);
      event.sender.send("claude:timeline:selectElements", { elements });
    },
  );

  // ---- Get selection (request-response) ----
  ipcMain.handle(
    "claude:timeline:getSelection",
    async (event: IpcMainInvokeEvent): Promise<ClaudeSelectionItem[]> => {
      claudeLog.info(HANDLER_NAME, "Getting current selection");
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error("Window not found");
      return requestSelectionFromRenderer(win);
    },
  );

  // ---- Clear selection (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:clearSelection",
    async (event: IpcMainInvokeEvent): Promise<void> => {
      claudeLog.info(HANDLER_NAME, "Clearing selection");
      event.sender.send("claude:timeline:clearSelection");
    },
  );

  claudeLog.info(HANDLER_NAME, "Timeline IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
  setupClaudeTimelineIPC,
  requestTimelineFromRenderer,
  requestSplitFromRenderer,
  requestSelectionFromRenderer,
  timelineToMarkdown,
  markdownToTimeline,
  validateTimeline,
};
