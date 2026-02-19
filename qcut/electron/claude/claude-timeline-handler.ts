/**
 * Claude Timeline API Handler
 * Provides timeline read/write capabilities for Claude Code integration
 */

import {
  ipcMain,
  BrowserWindow,
  IpcMainInvokeEvent,
  IpcMainEvent,
} from "electron";
import {
  formatTimeFromSeconds,
  parseTime,
  generateId,
} from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import type {
  ClaudeTimeline,
  ClaudeElement,
  ClaudeBatchAddElementRequest,
  ClaudeBatchAddResponse,
  ClaudeBatchDeleteItemRequest,
  ClaudeBatchDeleteResponse,
  ClaudeBatchUpdateItemRequest,
  ClaudeBatchUpdateResponse,
  ClaudeArrangeRequest,
  ClaudeArrangeResponse,
  ClaudeRangeDeleteRequest,
  ClaudeRangeDeleteResponse,
  ClaudeSplitResponse,
  ClaudeSelectionItem,
} from "../types/claude-api";

const HANDLER_NAME = "Timeline";
const MAX_TIMELINE_BATCH_ITEMS = 50;
const TIMELINE_REQUEST_TIMEOUT_MS = 5000;

/**
 * Request timeline data from renderer process
 */
export async function requestTimelineFromRenderer(
  win: BrowserWindow
): Promise<ClaudeTimeline> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener("claude:timeline:response", handler);
      reject(new Error("Timeout waiting for timeline data"));
    }, 5000);

    const handler = (_event: IpcMainEvent, timeline: ClaudeTimeline) => {
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
        25
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
function parseMarkdownSeconds(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Missing time value");
  }

  if (trimmed.endsWith("s")) {
    const seconds = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`Invalid seconds value: ${value}`);
    }
    return seconds;
  }

  if (/^\d+:\d{2}(?::\d{2})?$/.test(trimmed)) {
    return parseTime(trimmed);
  }

  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  throw new Error(`Invalid time value: ${value}`);
}

function parseMarkdownRow(line: string): string[] {
  const normalized = line.trim();
  if (!normalized.startsWith("|")) {
    throw new Error(`Invalid markdown row: ${line}`);
  }

  const withoutLeadingPipe = normalized.slice(1);
  const withoutTrailingPipe = withoutLeadingPipe.endsWith("|")
    ? withoutLeadingPipe.slice(0, -1)
    : withoutLeadingPipe;
  return withoutTrailingPipe.split("|").map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeElementType(typeValue: string): ClaudeElement["type"] {
  if (
    typeValue === "video" ||
    typeValue === "audio" ||
    typeValue === "image" ||
    typeValue === "text" ||
    typeValue === "sticker" ||
    typeValue === "captions" ||
    typeValue === "remotion" ||
    typeValue === "media"
  ) {
    return typeValue;
  }
  return "media";
}

function parseTimelineMetadataFromLine({
  line,
  timeline,
}: {
  line: string;
  timeline: ClaudeTimeline;
}): void {
  const trimmed = line.trim();
  const durationTableMatch = trimmed.match(/^\|\s*Duration\s*\|\s*(.+)\s*\|$/i);
  if (durationTableMatch) {
    timeline.duration = parseMarkdownSeconds(durationTableMatch[1]);
    return;
  }

  const durationBulletMatch = trimmed.match(/^-+\s*Duration:\s*(.+)$/i);
  if (durationBulletMatch) {
    timeline.duration = parseMarkdownSeconds(durationBulletMatch[1]);
    return;
  }

  const resolutionTableMatch = trimmed.match(
    /^\|\s*Resolution\s*\|\s*(\d+)\s*[x×]\s*(\d+)\s*\|$/i
  );
  if (resolutionTableMatch) {
    timeline.width = Number.parseInt(resolutionTableMatch[1], 10);
    timeline.height = Number.parseInt(resolutionTableMatch[2], 10);
    return;
  }

  const resolutionBulletMatch = trimmed.match(
    /^-+\s*Resolution:\s*(\d+)\s*[x×]\s*(\d+)$/i
  );
  if (resolutionBulletMatch) {
    timeline.width = Number.parseInt(resolutionBulletMatch[1], 10);
    timeline.height = Number.parseInt(resolutionBulletMatch[2], 10);
    return;
  }

  const fpsTableMatch = trimmed.match(/^\|\s*FPS\s*\|\s*(\d+(?:\.\d+)?)\s*\|$/i);
  if (fpsTableMatch) {
    timeline.fps = Number.parseFloat(fpsTableMatch[1]);
    return;
  }

  const fpsBulletMatch = trimmed.match(/^-+\s*FPS:\s*(\d+(?:\.\d+)?)$/i);
  if (fpsBulletMatch) {
    timeline.fps = Number.parseFloat(fpsBulletMatch[1]);
  }
}

export function markdownToTimeline(md: string): ClaudeTimeline {
  try {
    const timeline: ClaudeTimeline = {
      name: "Imported Timeline",
      duration: 0,
      width: 1920,
      height: 1080,
      fps: 30,
      tracks: [],
    };

    const lines = md.split(/\r?\n/);
    let currentLine = 0;

    const timelineNameMatch = md.match(/^#\s*Timeline:\s*(.+)$/im);
    const projectNameMatch = md.match(/^#\s*Project:\s*(.+)$/im);
    const resolvedName = timelineNameMatch || projectNameMatch;
    if (resolvedName) {
      timeline.name = resolvedName[1].trim();
    }

    for (const line of lines) {
      parseTimelineMetadataFromLine({ line, timeline });
    }

    while (currentLine < lines.length) {
      const headerLine = lines[currentLine].trim();
      const trackHeaderMatch = headerLine.match(
        /^##\s*Track\s+(\d+):\s*(.+)$/i
      );
      if (!trackHeaderMatch) {
        currentLine++;
        continue;
      }

      const trackIndex = Number.parseInt(trackHeaderMatch[1], 10) - 1;
      const rawTrackLabel = trackHeaderMatch[2].trim();
      const trackLabelMatch = rawTrackLabel.match(/^(.*)\(([^)]+)\)\s*$/);
      const trackName = trackLabelMatch
        ? trackLabelMatch[1].trim()
        : rawTrackLabel;
      let trackType = trackLabelMatch ? trackLabelMatch[2].trim() : "media";
      const parsedElements: ClaudeElement[] = [];
      let tableHeaders: string[] | null = null;

      currentLine++;

      while (currentLine < lines.length) {
        const line = lines[currentLine].trim();
        if (line.startsWith("## Track")) {
          break;
        }
        if (!line || line === "*No elements in this track*") {
          currentLine++;
          continue;
        }
        if (!line.startsWith("|")) {
          currentLine++;
          continue;
        }

        const rowCells = parseMarkdownRow(line);
        if (!tableHeaders) {
          tableHeaders = rowCells.map((header) => header.toLowerCase());
          currentLine++;
          continue;
        }
        if (isMarkdownSeparatorRow(rowCells)) {
          currentLine++;
          continue;
        }

        const rowValueByHeader = new Map<string, string>();
        for (const [headerIndex, header] of tableHeaders.entries()) {
          rowValueByHeader.set(header, rowCells[headerIndex] || "");
        }

        const rawType = rowValueByHeader.get("type");
        const rawStart = rowValueByHeader.get("start");
        const rawEnd = rowValueByHeader.get("end");
        const rawDuration = rowValueByHeader.get("duration");
        const rawSource = rowValueByHeader.get("source");
        const rawContent = rowValueByHeader.get("content");
        const rawElementId = rowValueByHeader.get("id");

        if (!rawType || !rawStart) {
          throw new Error(`Malformed track row on line ${currentLine + 1}`);
        }

        const startTime = parseMarkdownSeconds(rawStart);
        const duration =
          rawDuration && rawDuration !== "-"
            ? parseMarkdownSeconds(rawDuration)
            : rawEnd && rawEnd !== "-"
              ? Math.max(0, parseMarkdownSeconds(rawEnd) - startTime)
              : 0;
        const normalizedDuration = Math.max(0, duration);
        const elementType = normalizeElementType(rawType.trim().toLowerCase());
        const sourceName =
          rawSource && rawSource !== "-" ? rawSource.trim() : undefined;
        const content =
          rawContent && rawContent !== "-" ? rawContent.trim() : undefined;
        const generatedElementId = generateId("element");
        const elementId = rawElementId
          ? rawElementId.replaceAll("`", "").trim() || generatedElementId
          : generatedElementId;

        parsedElements.push({
          id: elementId,
          trackIndex: trackIndex < 0 ? 0 : trackIndex,
          startTime,
          endTime: startTime + normalizedDuration,
          duration: normalizedDuration,
          type: elementType,
          sourceName,
          content,
        });

        currentLine++;
      }

      if (!trackLabelMatch && parsedElements.length > 0) {
        const firstType = parsedElements[0].type;
        trackType = firstType === "text" ? "text" : "media";
      }

      const resolvedTrackIndex = timeline.tracks.length;
      timeline.tracks.push({
        id: generateId("track"),
        index: resolvedTrackIndex,
        name:
          trackName && trackName.length > 0
            ? trackName
            : `Track ${resolvedTrackIndex + 1}`,
        type: trackType || "media",
        elements: parsedElements.map((element) => ({
          ...element,
          trackIndex: resolvedTrackIndex,
        })),
      });
    }

    validateTimeline(timeline);
    return timeline;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown markdown parse error";
    throw new Error(`Invalid timeline markdown: ${message}`);
  }
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
  mode?: string
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
      _event: IpcMainEvent,
      data: { requestId: string; result: ClaudeSplitResponse }
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
  win: BrowserWindow
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
      _event: IpcMainEvent,
      data: { requestId: string; elements: ClaudeSelectionItem[] }
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

async function requestRendererResult<T>({
  win,
  requestChannel,
  responseChannel,
  payload,
  timeoutErrorMessage,
}: {
  win: BrowserWindow;
  requestChannel: string;
  responseChannel: string;
  payload: Record<string, unknown>;
  timeoutErrorMessage: string;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const requestId = generateId("req");

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener(responseChannel, responseHandler);
      reject(new Error(timeoutErrorMessage));
    }, TIMELINE_REQUEST_TIMEOUT_MS);

    const responseHandler = (
      _event: IpcMainEvent,
      data: { requestId: string; result: T }
    ) => {
      if (resolved || data.requestId !== requestId) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      ipcMain.removeListener(responseChannel, responseHandler);
      resolve(data.result);
    };

    ipcMain.on(responseChannel, responseHandler);
    win.webContents.send(requestChannel, {
      requestId,
      ...payload,
    });
  });
}

function normalizeBatchTrackElementType({
  type,
}: {
  type: ClaudeBatchAddElementRequest["type"];
}): "media" | "text" | "sticker" | "captions" | "remotion" {
  if (type === "video" || type === "audio" || type === "image") {
    return "media";
  }
  if (
    type === "media" ||
    type === "text" ||
    type === "sticker" ||
    type === "captions" ||
    type === "remotion"
  ) {
    return type;
  }
  return "media";
}

function isTrackCompatibleWithElementType({
  trackType,
  elementType,
}: {
  trackType: string;
  elementType: ClaudeBatchAddElementRequest["type"];
}): boolean {
  const normalizedElementType = normalizeBatchTrackElementType({
    type: elementType,
  });

  if (normalizedElementType === "text") return trackType === "text";
  if (normalizedElementType === "sticker") return trackType === "sticker";
  if (normalizedElementType === "captions") return trackType === "captions";
  if (normalizedElementType === "remotion") return trackType === "remotion";
  return trackType === "media" || trackType === "audio";
}

export async function requestBatchAddElementsFromRenderer(
  win: BrowserWindow,
  elements: ClaudeBatchAddElementRequest[]
): Promise<ClaudeBatchAddResponse> {
  return requestRendererResult<ClaudeBatchAddResponse>({
    win,
    requestChannel: "claude:timeline:batchAddElements",
    responseChannel: "claude:timeline:batchAddElements:response",
    payload: { elements },
    timeoutErrorMessage: "Timeout waiting for batch add result",
  });
}

export async function requestBatchUpdateElementsFromRenderer(
  win: BrowserWindow,
  updates: ClaudeBatchUpdateItemRequest[]
): Promise<ClaudeBatchUpdateResponse> {
  return requestRendererResult<ClaudeBatchUpdateResponse>({
    win,
    requestChannel: "claude:timeline:batchUpdateElements",
    responseChannel: "claude:timeline:batchUpdateElements:response",
    payload: { updates },
    timeoutErrorMessage: "Timeout waiting for batch update result",
  });
}

export async function requestBatchDeleteElementsFromRenderer(
  win: BrowserWindow,
  elements: ClaudeBatchDeleteItemRequest[],
  ripple = false
): Promise<ClaudeBatchDeleteResponse> {
  return requestRendererResult<ClaudeBatchDeleteResponse>({
    win,
    requestChannel: "claude:timeline:batchDeleteElements",
    responseChannel: "claude:timeline:batchDeleteElements:response",
    payload: { elements, ripple },
    timeoutErrorMessage: "Timeout waiting for batch delete result",
  });
}

export async function requestDeleteRangeFromRenderer(
  win: BrowserWindow,
  request: ClaudeRangeDeleteRequest
): Promise<ClaudeRangeDeleteResponse> {
  return requestRendererResult<ClaudeRangeDeleteResponse>({
    win,
    requestChannel: "claude:timeline:deleteRange",
    responseChannel: "claude:timeline:deleteRange:response",
    payload: { request },
    timeoutErrorMessage: "Timeout waiting for range delete result",
  });
}

export async function requestArrangeFromRenderer(
  win: BrowserWindow,
  request: ClaudeArrangeRequest
): Promise<ClaudeArrangeResponse> {
  return requestRendererResult<ClaudeArrangeResponse>({
    win,
    requestChannel: "claude:timeline:arrange",
    responseChannel: "claude:timeline:arrange:response",
    payload: { request },
    timeoutErrorMessage: "Timeout waiting for arrange result",
  });
}

export async function batchAddElements(
  win: BrowserWindow,
  _projectId: string,
  elements: ClaudeBatchAddElementRequest[]
): Promise<ClaudeBatchAddResponse> {
  try {
    if (!Array.isArray(elements)) {
      throw new Error("elements must be an array");
    }
    if (elements.length > MAX_TIMELINE_BATCH_ITEMS) {
      throw new Error(
        `Batch add limited to ${MAX_TIMELINE_BATCH_ITEMS} elements`
      );
    }
    if (elements.length === 0) {
      return { added: [], failedCount: 0 };
    }

    for (const element of elements) {
      if (!element.trackId || typeof element.trackId !== "string") {
        throw new Error("Each element must include a valid trackId");
      }
      if (
        typeof element.startTime !== "number" ||
        Number.isNaN(element.startTime) ||
        element.startTime < 0
      ) {
        throw new Error("Each element must include a non-negative startTime");
      }
      if (
        typeof element.duration !== "number" ||
        Number.isNaN(element.duration) ||
        element.duration <= 0
      ) {
        throw new Error("Each element must include a duration > 0");
      }
    }

    const timeline = await requestTimelineFromRenderer(win);
    const trackById = new Map<string, string>();
    for (const track of timeline.tracks) {
      if (track.id) {
        trackById.set(track.id, track.type);
      }
    }

    if (trackById.size > 0) {
      for (const element of elements) {
        const trackType = trackById.get(element.trackId);
        if (!trackType) {
          throw new Error(`Track not found: ${element.trackId}`);
        }
        if (
          !isTrackCompatibleWithElementType({
            trackType,
            elementType: element.type,
          })
        ) {
          throw new Error(
            `Element type '${element.type}' is not compatible with track '${element.trackId}' (${trackType})`
          );
        }
      }
    }

    return requestBatchAddElementsFromRenderer(win, elements);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to batch add elements"
    );
  }
}

export async function batchUpdateElements(
  win: BrowserWindow,
  updates: ClaudeBatchUpdateItemRequest[]
): Promise<ClaudeBatchUpdateResponse> {
  try {
    if (!Array.isArray(updates)) {
      throw new Error("updates must be an array");
    }
    if (updates.length > MAX_TIMELINE_BATCH_ITEMS) {
      throw new Error(
        `Batch update limited to ${MAX_TIMELINE_BATCH_ITEMS} updates`
      );
    }
    for (const update of updates) {
      if (!update.elementId || typeof update.elementId !== "string") {
        throw new Error("Each update must include a valid elementId");
      }
    }
    return requestBatchUpdateElementsFromRenderer(win, updates);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to batch update elements"
    );
  }
}

export async function batchDeleteElements(
  win: BrowserWindow,
  elements: ClaudeBatchDeleteItemRequest[],
  ripple = false
): Promise<ClaudeBatchDeleteResponse> {
  try {
    if (!Array.isArray(elements)) {
      throw new Error("elements must be an array");
    }
    if (elements.length > MAX_TIMELINE_BATCH_ITEMS) {
      throw new Error(
        `Batch delete limited to ${MAX_TIMELINE_BATCH_ITEMS} elements`
      );
    }
    for (const element of elements) {
      if (!element.trackId || typeof element.trackId !== "string") {
        throw new Error("Each delete item must include a valid trackId");
      }
      if (!element.elementId || typeof element.elementId !== "string") {
        throw new Error("Each delete item must include a valid elementId");
      }
    }
    return requestBatchDeleteElementsFromRenderer(win, elements, ripple);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to batch delete elements"
    );
  }
}

export async function deleteTimelineRange(
  win: BrowserWindow,
  request: ClaudeRangeDeleteRequest
): Promise<ClaudeRangeDeleteResponse> {
  try {
    if (
      typeof request.startTime !== "number" ||
      typeof request.endTime !== "number"
    ) {
      throw new Error("startTime and endTime must be numbers");
    }
    if (request.endTime <= request.startTime) {
      throw new Error("endTime must be greater than startTime");
    }
    return requestDeleteRangeFromRenderer(win, request);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to delete time range"
    );
  }
}

export async function arrangeTimeline(
  win: BrowserWindow,
  request: ClaudeArrangeRequest
): Promise<ClaudeArrangeResponse> {
  try {
    if (!request.trackId || typeof request.trackId !== "string") {
      throw new Error("trackId is required");
    }
    if (
      request.mode !== "sequential" &&
      request.mode !== "spaced" &&
      request.mode !== "manual"
    ) {
      throw new Error("mode must be one of: sequential, spaced, manual");
    }
    if (request.gap !== undefined && request.gap < 0) {
      throw new Error("gap must be >= 0");
    }
    if (request.startOffset !== undefined && request.startOffset < 0) {
      throw new Error("startOffset must be >= 0");
    }
    return requestArrangeFromRenderer(win, request);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to arrange timeline"
    );
  }
}

/** Register all Claude timeline IPC handlers for export, import, and element manipulation. */
export function setupClaudeTimelineIPC(): void {
  claudeLog.info(HANDLER_NAME, "Setting up Timeline IPC handlers...");

  ipcMain.handle(
    "claude:timeline:export",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      format: "json" | "md"
    ): Promise<string> => {
      claudeLog.info(
        HANDLER_NAME,
        `Exporting timeline for project: ${projectId}, format: ${format}`
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
    }
  );

  ipcMain.handle(
    "claude:timeline:import",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      data: string,
      format: "json" | "md"
    ): Promise<void> => {
      claudeLog.info(
        HANDLER_NAME,
        `Importing timeline for project: ${projectId}, format: ${format}`
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
    }
  );

  ipcMain.handle(
    "claude:timeline:addElement",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      element: Partial<ClaudeElement>
    ): Promise<string> => {
      claudeLog.info(HANDLER_NAME, `Adding element to project: ${projectId}`);
      const elementId = element.id || generateId("element");
      event.sender.send("claude:timeline:addElement", {
        ...element,
        id: elementId,
      });
      return elementId;
    }
  );

  ipcMain.handle(
    "claude:timeline:batchAddElements",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      elements: ClaudeBatchAddElementRequest[]
    ): Promise<ClaudeBatchAddResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Batch adding ${elements.length} element(s) to project: ${projectId}`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }
      return batchAddElements(win, projectId, elements);
    }
  );

  ipcMain.handle(
    "claude:timeline:updateElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      changes: Partial<ClaudeElement>
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Updating element: ${elementId}`);
      event.sender.send("claude:timeline:updateElement", {
        elementId,
        changes,
      });
    }
  );

  ipcMain.handle(
    "claude:timeline:batchUpdateElements",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      updates: ClaudeBatchUpdateItemRequest[]
    ): Promise<ClaudeBatchUpdateResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Batch updating ${updates.length} element(s)`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }
      return batchUpdateElements(win, updates);
    }
  );

  ipcMain.handle(
    "claude:timeline:removeElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Removing element: ${elementId}`);
      event.sender.send("claude:timeline:removeElement", elementId);
    }
  );

  ipcMain.handle(
    "claude:timeline:batchDeleteElements",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elements: ClaudeBatchDeleteItemRequest[],
      ripple?: boolean
    ): Promise<ClaudeBatchDeleteResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Batch deleting ${elements.length} element(s)`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }
      return batchDeleteElements(win, elements, ripple);
    }
  );

  // ---- Split element (request-response to get secondElementId) ----
  ipcMain.handle(
    "claude:timeline:splitElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      splitTime: number,
      mode?: "split" | "keepLeft" | "keepRight"
    ): Promise<ClaudeSplitResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Splitting element: ${elementId} at ${splitTime}s (mode: ${mode || "split"})`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error("Window not found");
      return requestSplitFromRenderer(win, elementId, splitTime, mode);
    }
  );

  // ---- Move element (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:moveElement",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elementId: string,
      toTrackId: string,
      newStartTime?: number
    ): Promise<void> => {
      claudeLog.info(
        HANDLER_NAME,
        `Moving element: ${elementId} to track: ${toTrackId}`
      );
      event.sender.send("claude:timeline:moveElement", {
        elementId,
        toTrackId,
        newStartTime,
      });
    }
  );

  // ---- Select elements (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:selectElements",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      elements: ClaudeSelectionItem[]
    ): Promise<void> => {
      claudeLog.info(HANDLER_NAME, `Selecting ${elements.length} element(s)`);
      event.sender.send("claude:timeline:selectElements", { elements });
    }
  );

  // ---- Get selection (request-response) ----
  ipcMain.handle(
    "claude:timeline:getSelection",
    async (event: IpcMainInvokeEvent): Promise<ClaudeSelectionItem[]> => {
      claudeLog.info(HANDLER_NAME, "Getting current selection");
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error("Window not found");
      return requestSelectionFromRenderer(win);
    }
  );

  // ---- Clear selection (fire-and-forget) ----
  ipcMain.handle(
    "claude:timeline:clearSelection",
    async (event: IpcMainInvokeEvent): Promise<void> => {
      claudeLog.info(HANDLER_NAME, "Clearing selection");
      event.sender.send("claude:timeline:clearSelection");
    }
  );

  ipcMain.handle(
    "claude:timeline:deleteRange",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      request: ClaudeRangeDeleteRequest
    ): Promise<ClaudeRangeDeleteResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Deleting timeline range ${request.startTime}s-${request.endTime}s`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }
      return deleteTimelineRange(win, request);
    }
  );

  ipcMain.handle(
    "claude:timeline:arrange",
    async (
      event: IpcMainInvokeEvent,
      _projectId: string,
      request: ClaudeArrangeRequest
    ): Promise<ClaudeArrangeResponse> => {
      claudeLog.info(
        HANDLER_NAME,
        `Arranging track ${request.trackId} (mode: ${request.mode})`
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        throw new Error("Window not found");
      }
      return arrangeTimeline(win, request);
    }
  );

  claudeLog.info(HANDLER_NAME, "Timeline IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
  setupClaudeTimelineIPC,
  requestTimelineFromRenderer,
  requestSplitFromRenderer,
  requestSelectionFromRenderer,
  requestBatchAddElementsFromRenderer,
  requestBatchUpdateElementsFromRenderer,
  requestBatchDeleteElementsFromRenderer,
  requestDeleteRangeFromRenderer,
  requestArrangeFromRenderer,
  batchAddElements,
  batchUpdateElements,
  batchDeleteElements,
  deleteTimelineRange,
  arrangeTimeline,
  timelineToMarkdown,
  markdownToTimeline,
  validateTimeline,
};
