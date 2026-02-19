/**
 * Claude Auto-Edit Handler
 * Orchestrates transcription + filler detection + batch cut execution
 * to automatically remove filler words and silences from a video element.
 */

import type { BrowserWindow } from "electron";
import { claudeLog } from "./utils/logger.js";
import { sanitizeProjectId } from "./utils/helpers.js";
import { HttpError } from "./utils/http-router.js";
import { transcribeMedia } from "./claude-transcribe-handler.js";
import { analyzeFillers } from "./claude-filler-handler.js";
import { executeBatchCuts } from "./claude-cuts-handler.js";
import { requestTimelineFromRenderer } from "./claude-timeline-handler.js";
import type {
  AutoEditRequest,
  AutoEditResponse,
  AutoEditCutInfo,
  CutInterval,
  BatchCutResponse,
} from "../types/claude-api";

const HANDLER_NAME = "AutoEdit";

/**
 * Merge overlapping or adjacent cut intervals.
 * Input must be sorted by start time ascending.
 */
export function mergeCutIntervals(
  cuts: AutoEditCutInfo[]
): AutoEditCutInfo[] {
  if (cuts.length <= 1) return cuts;

  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const merged: AutoEditCutInfo[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.start <= last.end) {
      // Overlapping or adjacent — extend the last interval
      last.end = Math.max(last.end, current.end);
      last.reason = `${last.reason}; ${current.reason}`;
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Auto-edit a video element: transcribe, detect fillers/silences, and cut them.
 */
export async function autoEdit(
  projectId: string,
  request: AutoEditRequest,
  win?: BrowserWindow
): Promise<AutoEditResponse> {
  const safeProjectId = sanitizeProjectId(projectId);

  if (!request.elementId) {
    throw new HttpError(400, "Missing 'elementId'");
  }
  if (!request.mediaId) {
    throw new HttpError(400, "Missing 'mediaId'");
  }

  const removeFillers = request.removeFillers !== false;
  const removeSilences = request.removeSilences !== false;
  const silenceThreshold = request.silenceThreshold ?? 1.0;
  const keepSilencePadding = request.keepSilencePadding ?? 0.3;
  const dryRun = request.dryRun ?? false;

  claudeLog.info(
    HANDLER_NAME,
    `Auto-edit: project=${safeProjectId}, element=${request.elementId}, ` +
      `fillers=${removeFillers}, silences=${removeSilences}, dryRun=${dryRun}`
  );

  // Step 1: Get element info to map media-time → timeline-time
  let elementStartTime = 0;
  let elementTrimStart = 0;
  if (win) {
    try {
      const timeline = await requestTimelineFromRenderer(win);
      for (const track of timeline.tracks) {
        const el = track.elements.find((e) => e.id === request.elementId);
        if (el) {
          elementStartTime = el.startTime;
          elementTrimStart = el.trimStart ?? 0;
          break;
        }
      }
    } catch {
      claudeLog.warn(HANDLER_NAME, "Could not get timeline, using offset 0");
    }
  }

  try {
    // Step 2: Transcribe
    const transcription = await transcribeMedia(safeProjectId, {
      mediaId: request.mediaId,
      provider: request.provider,
      language: request.language,
    });

    claudeLog.info(
      HANDLER_NAME,
      `Transcribed: ${transcription.words.length} words, ${transcription.duration}s`
    );

    // Step 3: Analyze fillers
    const fillerInput = transcription.words.map((w, i) => ({
      id: `w_${i}`,
      text: w.text,
      start: w.start,
      end: w.end,
      type: w.type === "word" ? ("word" as const) : ("spacing" as const),
      speaker_id: w.speaker ?? undefined,
    }));

    const analysis = await analyzeFillers(safeProjectId, {
      mediaId: request.mediaId,
      words: fillerInput,
    });

    claudeLog.info(
      HANDLER_NAME,
      `Analysis: ${analysis.fillers.length} fillers, ${analysis.silences.length} silences`
    );

    // Step 4: Build cut list from fillers and silences
    const cuts: AutoEditCutInfo[] = [];

    if (removeFillers) {
      for (const filler of analysis.fillers) {
        cuts.push({
          start: filler.start + elementStartTime + elementTrimStart,
          end: filler.end + elementStartTime + elementTrimStart,
          reason: `filler: ${filler.word}`,
        });
      }
    }

    if (removeSilences) {
      for (const silence of analysis.silences) {
        if (silence.duration < silenceThreshold) continue;

        // Keep padding on both sides of silence
        const paddedStart = silence.start + keepSilencePadding;
        const paddedEnd = silence.end - keepSilencePadding;

        if (paddedStart < paddedEnd) {
          cuts.push({
            start:
              paddedStart + elementStartTime + elementTrimStart,
            end: paddedEnd + elementStartTime + elementTrimStart,
            reason: `silence: ${silence.duration.toFixed(1)}s`,
          });
        }
      }
    }

    // Merge overlapping cuts
    const mergedCuts = mergeCutIntervals(cuts);

    const totalCutDuration = mergedCuts.reduce(
      (sum, c) => sum + (c.end - c.start),
      0
    );

    claudeLog.info(
      HANDLER_NAME,
      `Built ${mergedCuts.length} cuts (${totalCutDuration.toFixed(1)}s total)`
    );

    // Step 5: Optionally execute
    let applied = false;
    let result: BatchCutResponse | undefined;

    if (!dryRun && mergedCuts.length > 0 && win) {
      const cutIntervals: CutInterval[] = mergedCuts.map((c) => ({
        start: c.start,
        end: c.end,
      }));

      result = await executeBatchCuts(win, {
        elementId: request.elementId,
        cuts: cutIntervals,
        ripple: true,
      });
      applied = true;

      claudeLog.info(
        HANDLER_NAME,
        `Applied ${result.cutsApplied} cuts, removed ${result.totalRemovedDuration}s`
      );
    }

    return {
      transcription: {
        wordCount: transcription.words.length,
        duration: transcription.duration,
      },
      analysis: {
        fillerCount: analysis.fillers.length,
        silenceCount: analysis.silences.length,
        totalFillerTime: analysis.totalFillerTime,
        totalSilenceTime: analysis.totalSilenceTime,
      },
      cuts: mergedCuts,
      applied,
      result,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    const errorMessage =
      error instanceof Error ? error.message : "Unknown auto-edit error";
    claudeLog.error(HANDLER_NAME, `Auto-edit pipeline failed: ${errorMessage}`);
    throw new HttpError(500, "Auto-edit pipeline failed");
  }
}

// CommonJS export for compatibility
module.exports = { autoEdit, mergeCutIntervals };
