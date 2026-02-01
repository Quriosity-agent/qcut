/**
 * Claude Timeline API Handler
 * Provides timeline read/write capabilities for Claude Code integration
 */

import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { formatTimeFromSeconds, parseTime } from './utils/helpers.js';
import { claudeLog } from './utils/logger.js';
import type { ClaudeTimeline, ClaudeTrack, ClaudeElement } from '../types/claude-api';

const HANDLER_NAME = 'Timeline';

export function setupClaudeTimelineIPC(): void {
  claudeLog.info(HANDLER_NAME, 'Setting up Timeline IPC handlers...');

  // ============================================================================
  // claude:timeline:export - Export timeline as JSON or Markdown
  // ============================================================================
  ipcMain.handle('claude:timeline:export', async (event: IpcMainInvokeEvent, projectId: string, format: 'json' | 'md'): Promise<string> => {
    claudeLog.info(HANDLER_NAME, `Exporting timeline for project: ${projectId}, format: ${format}`);
    
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      throw new Error('Window not found');
    }
    
    // Request timeline data from renderer process
    const timeline = await requestTimelineFromRenderer(win, event);
    
    if (format === 'md') {
      return timelineToMarkdown(timeline);
    }
    return JSON.stringify(timeline, null, 2);
  });

  // ============================================================================
  // claude:timeline:import - Import timeline from JSON or Markdown
  // ============================================================================
  ipcMain.handle('claude:timeline:import', async (event: IpcMainInvokeEvent, projectId: string, data: string, format: 'json' | 'md'): Promise<void> => {
    claudeLog.info(HANDLER_NAME, `Importing timeline for project: ${projectId}, format: ${format}`);
    
    let timeline: ClaudeTimeline;
    
    if (format === 'md') {
      timeline = markdownToTimeline(data);
    } else {
      timeline = JSON.parse(data);
    }
    
    // Validate timeline
    validateTimeline(timeline);
    
    // Send to renderer process to apply changes
    event.sender.send('claude:timeline:apply', timeline);
    
    claudeLog.info(HANDLER_NAME, 'Timeline import sent to renderer');
  });

  // ============================================================================
  // claude:timeline:addElement - Add element to timeline
  // ============================================================================
  ipcMain.handle('claude:timeline:addElement', async (event: IpcMainInvokeEvent, projectId: string, element: Partial<ClaudeElement>): Promise<string> => {
    claudeLog.info(HANDLER_NAME, `Adding element to project: ${projectId}`);
    event.sender.send('claude:timeline:addElement', element);
    return element.id || '';
  });

  // ============================================================================
  // claude:timeline:updateElement - Update timeline element
  // ============================================================================
  ipcMain.handle('claude:timeline:updateElement', async (event: IpcMainInvokeEvent, projectId: string, elementId: string, changes: Partial<ClaudeElement>): Promise<void> => {
    claudeLog.info(HANDLER_NAME, `Updating element: ${elementId}`);
    event.sender.send('claude:timeline:updateElement', { elementId, changes });
  });

  // ============================================================================
  // claude:timeline:removeElement - Remove element from timeline
  // ============================================================================
  ipcMain.handle('claude:timeline:removeElement', async (event: IpcMainInvokeEvent, projectId: string, elementId: string): Promise<void> => {
    claudeLog.info(HANDLER_NAME, `Removing element: ${elementId}`);
    event.sender.send('claude:timeline:removeElement', elementId);
  });

  claudeLog.info(HANDLER_NAME, 'Timeline IPC handlers registered');
}

/**
 * Request timeline data from renderer process
 */
async function requestTimelineFromRenderer(win: BrowserWindow, event: IpcMainInvokeEvent): Promise<ClaudeTimeline> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('claude:timeline:response', handler);
      reject(new Error('Timeout waiting for timeline data'));
    }, 5000);
    
    const handler = (_event: any, timeline: ClaudeTimeline) => {
      clearTimeout(timeout);
      resolve(timeline);
    };
    
    ipcMain.once('claude:timeline:response', handler);
    win.webContents.send('claude:timeline:request');
  });
}

/**
 * Convert Timeline to Markdown format
 */
function timelineToMarkdown(timeline: ClaudeTimeline): string {
  let md = `# Timeline: ${timeline.name}\n\n`;
  
  md += `## Project Info\n\n`;
  md += `| Property | Value |\n`;
  md += `|----------|-------|\n`;
  md += `| Duration | ${formatTimeFromSeconds(timeline.duration)} |\n`;
  md += `| Resolution | ${timeline.width}x${timeline.height} |\n`;
  md += `| FPS | ${timeline.fps} |\n`;
  md += `| Tracks | ${timeline.tracks.length} |\n\n`;
  
  for (const track of timeline.tracks) {
    md += `## Track ${track.index + 1}: ${track.name || track.type}\n\n`;
    
    if (track.elements.length === 0) {
      md += `*No elements in this track*\n\n`;
      continue;
    }
    
    md += `| ID | Start | End | Duration | Type | Source | Content |\n`;
    md += `|----|-------|-----|----------|------|--------|--------|\n`;
    
    for (const element of track.elements) {
      const content = (element.content || element.sourceName || '-').substring(0, 25);
      md += `| \`${element.id.substring(0, 8)}\` | ${formatTimeFromSeconds(element.startTime)} | ${formatTimeFromSeconds(element.endTime)} | ${formatTimeFromSeconds(element.duration)} | ${element.type} | ${element.sourceName || '-'} | ${content} |\n`;
    }
    md += `\n`;
  }
  
  md += `---\n\n`;
  md += `*Exported at: ${new Date().toISOString()}*\n`;
  
  return md;
}

/**
 * Parse Markdown to Timeline
 */
function markdownToTimeline(md: string): ClaudeTimeline {
  const timeline: ClaudeTimeline = {
    name: 'Imported Timeline',
    duration: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
  };
  
  // Parse project name
  const nameMatch = md.match(/# Timeline: (.+)/);
  if (nameMatch) {
    timeline.name = nameMatch[1].trim();
  }
  
  // Parse resolution
  const resMatch = md.match(/Resolution \| (\d+)x(\d+)/);
  if (resMatch) {
    timeline.width = parseInt(resMatch[1]);
    timeline.height = parseInt(resMatch[2]);
  }
  
  // Parse FPS
  const fpsMatch = md.match(/FPS \| (\d+)/);
  if (fpsMatch) {
    timeline.fps = parseInt(fpsMatch[1]);
  }
  
  // Parse duration
  const durationMatch = md.match(/Duration \| (\d+:\d+:\d+)/);
  if (durationMatch) {
    timeline.duration = parseTime(durationMatch[1]);
  }
  
  claudeLog.warn(HANDLER_NAME, 'Markdown parsing is basic - track/element parsing not fully implemented');
  
  return timeline;
}

/**
 * Validate timeline structure
 */
function validateTimeline(timeline: ClaudeTimeline): void {
  if (!timeline.name) {
    throw new Error('Timeline must have a name');
  }
  if (!timeline.tracks || !Array.isArray(timeline.tracks)) {
    throw new Error('Timeline must have tracks array');
  }
  if (timeline.width <= 0 || timeline.height <= 0) {
    throw new Error('Timeline must have valid dimensions');
  }
  if (timeline.fps <= 0) {
    throw new Error('Timeline must have valid FPS');
  }
  
  // Validate each track
  for (const track of timeline.tracks) {
    if (typeof track.index !== 'number') {
      throw new Error('Track must have an index');
    }
    if (!Array.isArray(track.elements)) {
      throw new Error('Track must have elements array');
    }
    
    // Validate each element
    for (const element of track.elements) {
      if (element.startTime < 0 || element.endTime < element.startTime) {
        throw new Error(`Invalid element timing: ${element.id}`);
      }
    }
  }
}

// CommonJS export for main.ts compatibility
module.exports = { setupClaudeTimelineIPC };
