/**
 * Claude Batch Cut-List Handler
 * Accepts a list of time intervals to remove from a video element,
 * executing all cuts atomically with single-undo support.
 */

import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { generateId } from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import { HttpError } from "./utils/http-router.js";
import type {
  CutInterval,
  BatchCutRequest,
  BatchCutResponse,
} from "../types/claude-api";

const HANDLER_NAME = "Cuts";
const BATCH_CUT_TIMEOUT = 30_000;

/**
 * Validate the batch cut request and reject invalid inputs.
 */
export function validateBatchCutRequest(request: BatchCutRequest): void {
  if (!request.elementId || typeof request.elementId !== "string") {
    throw new HttpError(400, "Missing or invalid 'elementId'");
  }
  if (!Array.isArray(request.cuts) || request.cuts.length === 0) {
    throw new HttpError(400, "Missing or empty 'cuts' array");
  }

  for (let i = 0; i < request.cuts.length; i++) {
    const cut = request.cuts[i];
    if (typeof cut.start !== "number" || typeof cut.end !== "number") {
      throw new HttpError(400, `Cut[${i}]: start and end must be numbers`);
    }
    if (cut.start < 0 || cut.end < 0) {
      throw new HttpError(400, `Cut[${i}]: start and end must be non-negative`);
    }
    if (cut.start >= cut.end) {
      throw new HttpError(
        400,
        `Cut[${i}]: start (${cut.start}) must be less than end (${cut.end})`
      );
    }
  }

  // Check for overlapping intervals (sort ascending first)
  const sorted = [...request.cuts].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new HttpError(
        400,
        `Overlapping cuts: [${sorted[i - 1].start}-${sorted[i - 1].end}] and [${sorted[i].start}-${sorted[i].end}]`
      );
    }
  }
}

/**
 * Send batch cut operation to the renderer and wait for the result.
 * Follows the requestSplitFromRenderer IPC request-response pattern.
 */
export async function executeBatchCuts(
  win: BrowserWindow,
  request: BatchCutRequest
): Promise<BatchCutResponse> {
  validateBatchCutRequest(request);

  claudeLog.info(
    HANDLER_NAME,
    `Batch cuts: element=${request.elementId}, cuts=${request.cuts.length}, ripple=${request.ripple ?? true}`
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    const requestId = generateId("req");

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeListener("claude:timeline:executeCuts:response", handler);
      reject(new Error("Timeout waiting for batch cut result"));
    }, BATCH_CUT_TIMEOUT);

    const handler = (
      _event: IpcMainEvent,
      data: { requestId: string; result: BatchCutResponse }
    ) => {
      if (data.requestId !== requestId || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ipcMain.removeListener("claude:timeline:executeCuts:response", handler);
      resolve(data.result);
    };

    ipcMain.on("claude:timeline:executeCuts:response", handler);
    win.webContents.send("claude:timeline:executeCuts", {
      requestId,
      elementId: request.elementId,
      cuts: request.cuts,
      ripple: request.ripple ?? true,
    });
  });
}

// CommonJS export for compatibility
module.exports = { executeBatchCuts, validateBatchCutRequest };
