/**
 * Claude Export API Handler
 * Provides export presets and recommendations for Claude Code integration
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { claudeLog } from "./utils/logger.js";
import type { ExportPreset, ExportRecommendation } from "../types/claude-api";

const HANDLER_NAME = "Export";

// Platform-specific export presets
export const PRESETS: ExportPreset[] = [
  {
    id: "youtube-4k",
    name: "YouTube 4K",
    platform: "youtube",
    width: 3840,
    height: 2160,
    fps: 60,
    bitrate: "45Mbps",
    format: "mp4",
  },
  {
    id: "youtube-1080p",
    name: "YouTube 1080p",
    platform: "youtube",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: "8Mbps",
    format: "mp4",
  },
  {
    id: "youtube-720p",
    name: "YouTube 720p",
    platform: "youtube",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: "5Mbps",
    format: "mp4",
  },
  {
    id: "tiktok",
    name: "TikTok",
    platform: "tiktok",
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: "6Mbps",
    format: "mp4",
  },
  {
    id: "instagram-reel",
    name: "Instagram Reel",
    platform: "instagram",
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: "5Mbps",
    format: "mp4",
  },
  {
    id: "instagram-post",
    name: "Instagram Post (Square)",
    platform: "instagram",
    width: 1080,
    height: 1080,
    fps: 30,
    bitrate: "5Mbps",
    format: "mp4",
  },
  {
    id: "instagram-landscape",
    name: "Instagram Post (Landscape)",
    platform: "instagram",
    width: 1080,
    height: 566,
    fps: 30,
    bitrate: "5Mbps",
    format: "mp4",
  },
  {
    id: "twitter",
    name: "Twitter/X",
    platform: "twitter",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: "6Mbps",
    format: "mp4",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    platform: "linkedin",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: "8Mbps",
    format: "mp4",
  },
  {
    id: "discord",
    name: "Discord (8MB limit)",
    platform: "discord",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: "2Mbps",
    format: "mp4",
  },
];

/**
 * Get all export presets
 */
export function getExportPresets(): ExportPreset[] {
  claudeLog.info(HANDLER_NAME, "Returning all export presets");
  return PRESETS;
}

/**
 * Get export recommendation for a specific platform/target
 */
export function getExportRecommendation(target: string): ExportRecommendation {
  claudeLog.info(HANDLER_NAME, `Recommending export for target: ${target}`);

  const preset =
    PRESETS.find((p) => p.platform === target || p.id === target) || PRESETS[1];

  const warnings: string[] = [];
  const suggestions: string[] = [];

  switch (preset.platform) {
    case "tiktok":
      suggestions.push("Videos under 60 seconds perform best on TikTok");
      suggestions.push(
        "Add captions for better engagement (85% watch without sound)"
      );
      suggestions.push("Use trending sounds when possible");
      warnings.push("Maximum video length is 10 minutes");
      break;

    case "instagram":
      suggestions.push("Reels should be 15-90 seconds for optimal reach");
      suggestions.push("Use trending audio when possible");
      suggestions.push("Add text overlays for accessibility");
      warnings.push("Instagram compresses videos - export at higher quality");
      break;

    case "youtube":
      suggestions.push("Add chapters for longer videos (>10 minutes)");
      suggestions.push("Include end screen in last 20 seconds");
      suggestions.push("Add closed captions for better SEO");
      break;

    case "twitter":
      warnings.push("Maximum video length is 2 minutes 20 seconds");
      suggestions.push("Keep it concise for better engagement");
      suggestions.push("Add captions - Twitter autoplays muted");
      break;

    case "linkedin":
      suggestions.push("Professional content performs best");
      suggestions.push("Keep videos under 3 minutes for best engagement");
      suggestions.push("Add subtitles - many watch at work without sound");
      break;

    case "discord":
      warnings.push("Free users have 8MB file size limit");
      suggestions.push("Consider lower resolution for longer videos");
      suggestions.push("Nitro users can upload up to 100MB");
      break;
  }

  return { preset, warnings, suggestions };
}

/** Register Claude export IPC handlers for presets and recommendations. */
export function setupClaudeExportIPC(): void {
  claudeLog.info(HANDLER_NAME, "Setting up Export IPC handlers...");

  ipcMain.handle("claude:export:getPresets", async () => getExportPresets());

  ipcMain.handle(
    "claude:export:recommend",
    async (_event: IpcMainInvokeEvent, _projectId: string, target: string) =>
      getExportRecommendation(target)
  );

  claudeLog.info(HANDLER_NAME, "Export IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
  setupClaudeExportIPC,
  PRESETS,
  getExportPresets,
  getExportRecommendation,
};
