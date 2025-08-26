import type { 
  ExportSettings, 
  ExportProgress,
  ExportFormat,
  ExportQuality,
  ExportPurpose 
} from '@/types/export';

/**
 * Mock export settings matching types/export.ts
 */
export const mockExportSettingsHD: ExportSettings = {
  format: 'mp4' as ExportFormat,
  quality: '1080p' as ExportQuality,
  filename: 'test-export-hd.mp4',
  width: 1920,
  height: 1080,
  purpose: 'final' as ExportPurpose,
};

export const mockExportSettingsMedium: ExportSettings = {
  format: 'webm' as ExportFormat,
  quality: '720p' as ExportQuality,
  filename: 'test-export-720p.webm',
  width: 1280,
  height: 720,
  purpose: 'preview' as ExportPurpose,
};

export const mockExportSettingsLow: ExportSettings = {
  format: 'mov' as ExportFormat,
  quality: '480p' as ExportQuality,
  filename: 'test-export-480p.mov',
  width: 854,
  height: 480,
  purpose: 'preview' as ExportPurpose,
};

/**
 * Mock export progress states
 */
export const mockExportProgressStart: ExportProgress = {
  isExporting: true,
  progress: 0,
  currentFrame: 0,
  totalFrames: 300,
  estimatedTimeRemaining: 60,
  status: 'Starting export...',
  encodingSpeed: 0,
  processedFrames: 0,
  startTime: new Date(),
  elapsedTime: 0,
  averageFrameTime: 0,
};

export const mockExportProgressMiddle: ExportProgress = {
  isExporting: true,
  progress: 50,
  currentFrame: 150,
  totalFrames: 300,
  estimatedTimeRemaining: 30,
  status: 'Processing frame 150 of 300...',
  encodingSpeed: 5,
  processedFrames: 150,
  startTime: new Date(Date.now() - 30000), // 30 seconds ago
  elapsedTime: 30,
  averageFrameTime: 200, // 200ms per frame
};

export const mockExportProgressComplete: ExportProgress = {
  isExporting: false,
  progress: 100,
  currentFrame: 300,
  totalFrames: 300,
  estimatedTimeRemaining: 0,
  status: 'Export complete!',
  encodingSpeed: 5,
  processedFrames: 300,
  startTime: new Date(Date.now() - 60000), // 1 minute ago
  elapsedTime: 60,
  averageFrameTime: 200,
};

export const mockExportProgressError: ExportProgress = {
  isExporting: false,
  progress: 75,
  currentFrame: 225,
  totalFrames: 300,
  estimatedTimeRemaining: 0,
  status: 'Export failed: Insufficient memory',
  encodingSpeed: 0,
  processedFrames: 225,
  startTime: new Date(Date.now() - 45000),
  elapsedTime: 45,
  averageFrameTime: 200,
};

/**
 * Create custom export settings
 */
export function createMockExportSettings(
  overrides: Partial<ExportSettings> = {}
): ExportSettings {
  return {
    ...mockExportSettingsHD,
    ...overrides,
  };
}

/**
 * Create custom export progress
 */
export function createMockExportProgress(
  progress: number,
  totalFrames: number = 300
): ExportProgress {
  const currentFrame = Math.floor((progress / 100) * totalFrames);
  const elapsedTime = progress > 0 ? Math.floor(progress * 0.6) : 0; // Assume 60 seconds total
  const remainingTime = Math.max(0, 60 - elapsedTime);
  
  return {
    isExporting: progress < 100,
    progress,
    currentFrame,
    totalFrames,
    estimatedTimeRemaining: remainingTime,
    status: progress < 100 
      ? `Processing frame ${currentFrame} of ${totalFrames}...`
      : 'Export complete!',
    encodingSpeed: progress > 0 ? 5 : 0,
    processedFrames: currentFrame,
    startTime: new Date(Date.now() - (elapsedTime * 1000)),
    elapsedTime,
    averageFrameTime: elapsedTime > 0 ? (elapsedTime * 1000) / currentFrame : 0,
  };
}