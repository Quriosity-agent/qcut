/**
 * Claude summary/report generation utilities.
 */

import { app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ClaudeTimeline,
  ExportJobStatus,
  MediaFile,
  PipelineReport,
  PipelineStep,
  ProjectSettings,
  ProjectSummary,
} from "../types/claude-api";

const STAGE_LABELS = {
  1: "Import",
  2: "Understanding",
  3: "Editing",
  4: "Organization",
  5: "Export",
} as const;

function formatDurationSeconds({ seconds }: { seconds: number }): string {
  try {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "0:00";
    }

    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  } catch {
    return "0:00";
  }
}

function formatDate({ timestamp }: { timestamp: number }): string {
  try {
    return new Date(timestamp).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getTimelineDuration({
  timeline,
}: {
  timeline: ClaudeTimeline;
}): number {
  try {
    if (timeline.duration > 0) {
      return timeline.duration;
    }

    let maxEnd = 0;
    for (const track of timeline.tracks) {
      for (const element of track.elements) {
        const endTime =
          typeof element.endTime === "number"
            ? element.endTime
            : element.startTime + element.duration;
        if (endTime > maxEnd) {
          maxEnd = endTime;
        }
      }
    }
    return maxEnd;
  } catch {
    return 0;
  }
}

function countTrackDurations({
  timeline,
}: {
  timeline: ClaudeTimeline;
}): Array<{
  trackName: string;
  trackType: string;
  elementCount: number;
  duration: number;
}> {
  try {
    const rows: Array<{
      trackName: string;
      trackType: string;
      elementCount: number;
      duration: number;
    }> = [];

    for (const track of timeline.tracks) {
      let maxTrackEnd = 0;
      for (const element of track.elements) {
        const endTime =
          typeof element.endTime === "number"
            ? element.endTime
            : element.startTime + element.duration;
        if (endTime > maxTrackEnd) {
          maxTrackEnd = endTime;
        }
      }

      rows.push({
        trackName: track.name || `Track ${track.index + 1}`,
        trackType: track.type,
        elementCount: track.elements.length,
        duration: maxTrackEnd,
      });
    }

    return rows;
  } catch {
    return [];
  }
}

export function generateProjectSummary({
  timeline,
  mediaFiles,
  exportJobs,
  settings,
}: {
  timeline: ClaudeTimeline;
  mediaFiles: MediaFile[];
  exportJobs: ExportJobStatus[];
  settings: ProjectSettings;
}): ProjectSummary {
  try {
    const timelineDuration = getTimelineDuration({ timeline });
    const trackCount = timeline.tracks.length;
    const elementCount = timeline.tracks.reduce(
      (sum, track) => sum + track.elements.length,
      0
    );

    const mediaCount = {
      video: 0,
      audio: 0,
      image: 0,
    };

    let totalSourceDuration = 0;
    for (const mediaFile of mediaFiles) {
      if (mediaFile.type === "video") {
        mediaCount.video += 1;
      }
      if (mediaFile.type === "audio") {
        mediaCount.audio += 1;
      }
      if (mediaFile.type === "image") {
        mediaCount.image += 1;
      }
      if (typeof mediaFile.duration === "number" && mediaFile.duration > 0) {
        totalSourceDuration += mediaFile.duration;
      }
    }

    const completedExports = exportJobs
      .filter((job) => job.status === "completed")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    const trackRows = countTrackDurations({ timeline });

    let markdown = `## Project: ${settings.name || timeline.name || "Untitled"}\n\n`;
    markdown += "### Settings\n";
    markdown += `- Resolution: ${settings.width}x${settings.height} @ ${settings.fps}fps\n`;
    markdown += `- Aspect Ratio: ${settings.aspectRatio}\n`;
    markdown += `- Export Format: ${settings.exportFormat}\n\n`;

    markdown += "### Media Library\n";
    markdown += `- Videos: ${mediaCount.video}\n`;
    markdown += `- Audio: ${mediaCount.audio}\n`;
    markdown += `- Images: ${mediaCount.image}\n`;
    markdown += `- Total Files: ${mediaFiles.length}\n\n`;

    markdown += "### Timeline\n";
    if (trackRows.length === 0) {
      markdown += "- No tracks available\n\n";
    } else {
      for (const row of trackRows) {
        markdown += `- ${row.trackName} (${row.trackType}): ${row.elementCount} elements, ${formatDurationSeconds({ seconds: row.duration })}\n`;
      }
      markdown += "\n";
    }

    markdown += "### Exports\n";
    if (completedExports.length === 0) {
      markdown += "- No completed exports\n";
    } else {
      for (const job of completedExports.slice(0, 10)) {
        const completedAt =
          typeof job.completedAt === "number"
            ? formatDate({ timestamp: job.completedAt })
            : "unknown";
        const size =
          typeof job.fileSize === "number"
            ? `${(job.fileSize / (1024 * 1024)).toFixed(1)}MB`
            : "size unknown";
        markdown += `- ${job.presetId ?? "custom"}: completed ${completedAt} (${size})\n`;
      }
    }

    return {
      markdown,
      stats: {
        totalDuration: timelineDuration,
        trackCount,
        elementCount,
        mediaFileCount: mediaFiles.length,
        exportCount: completedExports.length,
        totalSourceDuration,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate summary";
    return {
      markdown: `## Project Summary\n\n- Error generating summary: ${message}\n`,
      stats: {
        totalDuration: 0,
        trackCount: 0,
        elementCount: 0,
        mediaFileCount: 0,
        exportCount: 0,
        totalSourceDuration: 0,
      },
    };
  }
}

function groupStepsByStage({
  steps,
}: {
  steps: PipelineStep[];
}): Record<number, PipelineStep[]> {
  try {
    const grouped: Record<number, PipelineStep[]> = {
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
    };

    for (const step of steps) {
      if (step.stage >= 1 && step.stage <= 5) {
        grouped[step.stage].push(step);
      }
    }

    for (const stage of Object.keys(grouped)) {
      grouped[Number.parseInt(stage, 10)].sort(
        (a, b) => a.timestamp - b.timestamp
      );
    }

    return grouped;
  } catch {
    return { 1: [], 2: [], 3: [], 4: [], 5: [] };
  }
}

function buildReportMarkdown({
  steps,
  summary,
}: {
  steps: PipelineStep[];
  summary: ProjectSummary;
}): string {
  try {
    const grouped = groupStepsByStage({ steps });
    const today = formatDate({ timestamp: Date.now() });

    let markdown = "## Auto-Edit Pipeline Report\n\n";
    markdown += `**Date**: ${today}\n`;
    markdown += "\n";

    if (steps.length === 0) {
      markdown +=
        "No recorded pipeline operations were found for this project.\n\n";
    }

    for (const stageNumber of [1, 2, 3, 4, 5]) {
      markdown += `### Stage ${stageNumber}: ${STAGE_LABELS[stageNumber as keyof typeof STAGE_LABELS]}\n`;
      const stageSteps = grouped[stageNumber];

      if (stageSteps.length === 0) {
        markdown += "- No operations recorded\n\n";
        continue;
      }

      for (const step of stageSteps) {
        const durationSuffix =
          typeof step.duration === "number" && step.duration > 0
            ? ` (${step.duration.toFixed(1)}s)`
            : "";
        markdown += `- ${step.details}${durationSuffix}\n`;
      }
      markdown += "\n";
    }

    const originalDuration =
      summary.stats.totalSourceDuration > 0
        ? summary.stats.totalSourceDuration
        : summary.stats.totalDuration;
    const finalDuration = summary.stats.totalDuration;
    const savedDuration = Math.max(0, originalDuration - finalDuration);
    const reduction =
      originalDuration > 0 ? (savedDuration / originalDuration) * 100 : 0;

    markdown += "### Statistics\n";
    markdown += `- Original footage: ${formatDurationSeconds({ seconds: originalDuration })}\n`;
    markdown += `- Final duration: ${formatDurationSeconds({ seconds: finalDuration })}\n`;
    markdown += `- Time saved: ${formatDurationSeconds({ seconds: savedDuration })} (${reduction.toFixed(1)}% reduction)\n\n`;
    markdown += "### Project Summary\n";
    markdown += summary.markdown;

    return markdown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build report";
    return `## Auto-Edit Pipeline Report\n\n- Failed to build report: ${message}\n`;
  }
}

export async function generatePipelineReport({
  steps,
  summary,
  saveToDisk,
  outputDir,
  projectId,
}: {
  steps: PipelineStep[];
  summary: ProjectSummary;
  saveToDisk?: boolean;
  outputDir?: string;
  projectId: string;
}): Promise<PipelineReport> {
  try {
    const markdown = buildReportMarkdown({ steps, summary });

    if (!saveToDisk) {
      return { markdown };
    }

    const resolvedOutputDir = outputDir?.trim()
      ? resolve(outputDir)
      : join(app.getPath("documents"), "QCut", "Reports");

    await mkdir(resolvedOutputDir, { recursive: true });

    const datePart = new Date().toISOString().slice(0, 10);
    const safeProjectId = /^[A-Za-z0-9_-]+$/.test(projectId)
      ? projectId
      : "unknown-project";
    const fileName = `pipeline-report-${safeProjectId}-${datePart}.md`;
    const fullPath = join(resolvedOutputDir, fileName);

    await writeFile(fullPath, markdown, "utf8");
    return {
      markdown,
      savedTo: fullPath,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate report";
    return {
      markdown: `## Auto-Edit Pipeline Report\n\n- ${message}\n`,
    };
  }
}
