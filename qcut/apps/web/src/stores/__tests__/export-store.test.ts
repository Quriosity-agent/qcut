import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExportStore } from '@/stores/export-store';
import type { ExportSettings, ExportProgress } from '@/types/export';

describe('ExportStore', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useExportStore());
    act(() => {
      result.current.resetExport();
      result.current.clearHistory();
    });
  });
  
  it('initializes with default settings', () => {
    const { result } = renderHook(() => useExportStore());
    
    expect(result.current.settings.format).toBe('mp4');
    expect(result.current.settings.quality).toBe('high');
    expect(result.current.settings.fps).toBe(30);
    expect(result.current.settings.includeAudio).toBe(true);
    expect(result.current.settings.includeSubtitles).toBe(false);
    expect(result.current.isDialogOpen).toBe(false);
    expect(result.current.panelView).toBe('properties');
  });
  
  it('updates export settings', () => {
    const { result } = renderHook(() => useExportStore());
    
    act(() => {
      result.current.updateSettings({
        quality: 'ultra',
        fps: 60,
        includeAudio: false,
        includeSubtitles: true
      });
    });
    
    expect(result.current.settings.quality).toBe('ultra');
    expect(result.current.settings.fps).toBe(60);
    expect(result.current.settings.includeAudio).toBe(false);
    expect(result.current.settings.includeSubtitles).toBe(true);
    // Format should remain unchanged
    expect(result.current.settings.format).toBe('mp4');
  });
  
  it('updates export format', () => {
    const { result } = renderHook(() => useExportStore());
    
    act(() => {
      result.current.updateSettings({
        format: 'webm'
      });
    });
    
    expect(result.current.settings.format).toBe('webm');
  });
  
  it('tracks export progress', () => {
    const { result } = renderHook(() => useExportStore());
    
    act(() => {
      result.current.updateProgress({
        percentage: 0,
        stage: 'preparing',
        timeRemaining: 120
      });
    });
    
    expect(result.current.progress.percentage).toBe(0);
    expect(result.current.progress.stage).toBe('preparing');
    expect(result.current.progress.timeRemaining).toBe(120);
    
    act(() => {
      result.current.updateProgress({
        percentage: 50,
        stage: 'encoding',
        timeRemaining: 60
      });
    });
    
    expect(result.current.progress.percentage).toBe(50);
    expect(result.current.progress.stage).toBe('encoding');
    expect(result.current.progress.timeRemaining).toBe(60);
    
    act(() => {
      result.current.updateProgress({
        percentage: 100,
        stage: 'complete',
        timeRemaining: 0
      });
    });
    
    expect(result.current.progress.percentage).toBe(100);
    expect(result.current.progress.stage).toBe('complete');
    expect(result.current.progress.timeRemaining).toBe(0);
  });
  
  it('manages export history', () => {
    const { result } = renderHook(() => useExportStore());
    
    expect(result.current.exportHistory).toHaveLength(0);
    
    act(() => {
      result.current.addToHistory({
        filename: 'test-export.mp4',
        settings: result.current.settings,
        duration: 120,
        fileSize: 50000000,
        success: true
      });
    });
    
    expect(result.current.exportHistory).toHaveLength(1);
    expect(result.current.exportHistory[0].filename).toBe('test-export.mp4');
    expect(result.current.exportHistory[0].duration).toBe(120);
    expect(result.current.exportHistory[0].fileSize).toBe(50000000);
    expect(result.current.exportHistory[0].success).toBe(true);
    expect(result.current.exportHistory[0].id).toBeDefined();
    expect(result.current.exportHistory[0].timestamp).toBeDefined();
  });
  
  it('adds failed export to history', () => {
    const { result } = renderHook(() => useExportStore());
    
    act(() => {
      result.current.addToHistory({
        filename: 'failed-export.mp4',
        settings: result.current.settings,
        duration: 30,
        success: false,
        error: 'Encoding failed: insufficient memory'
      });
    });
    
    expect(result.current.exportHistory).toHaveLength(1);
    expect(result.current.exportHistory[0].success).toBe(false);
    expect(result.current.exportHistory[0].error).toBe('Encoding failed: insufficient memory');
  });
  
  it('clears export history', () => {
    const { result } = renderHook(() => useExportStore());
    
    // Add multiple history entries
    act(() => {
      result.current.addToHistory({
        filename: 'export1.mp4',
        settings: result.current.settings,
        duration: 60,
        success: true
      });
      result.current.addToHistory({
        filename: 'export2.mp4',
        settings: result.current.settings,
        duration: 90,
        success: true
      });
    });
    
    expect(result.current.exportHistory).toHaveLength(2);
    
    act(() => {
      result.current.clearHistory();
    });
    
    expect(result.current.exportHistory).toHaveLength(0);
  });
  
  it('manages dialog state', () => {
    const { result } = renderHook(() => useExportStore());
    
    expect(result.current.isDialogOpen).toBe(false);
    
    act(() => {
      result.current.setDialogOpen(true);
    });
    
    expect(result.current.isDialogOpen).toBe(true);
    
    act(() => {
      result.current.setDialogOpen(false);
    });
    
    expect(result.current.isDialogOpen).toBe(false);
  });
  
  it('manages panel view', () => {
    const { result } = renderHook(() => useExportStore());
    
    expect(result.current.panelView).toBe('properties');
    
    act(() => {
      result.current.setPanelView('export');
    });
    
    expect(result.current.panelView).toBe('export');
    
    act(() => {
      result.current.setPanelView('settings');
    });
    
    expect(result.current.panelView).toBe('settings');
  });
  
  it('sets and clears error state', () => {
    const { result } = renderHook(() => useExportStore());
    
    expect(result.current.error).toBe(null);
    
    act(() => {
      result.current.setError('FFmpeg not loaded');
    });
    
    expect(result.current.error).toBe('FFmpeg not loaded');
    
    act(() => {
      result.current.setError(null);
    });
    
    expect(result.current.error).toBe(null);
  });
  
  it('resets export state', () => {
    const { result } = renderHook(() => useExportStore());
    
    // Set various states
    act(() => {
      result.current.updateProgress({
        percentage: 75,
        stage: 'encoding',
        timeRemaining: 30
      });
      result.current.setError('Test error');
      result.current.updateSettings({
        quality: 'low',
        fps: 24
      });
    });
    
    // Reset
    act(() => {
      result.current.resetExport();
    });
    
    expect(result.current.progress.percentage).toBe(0);
    expect(result.current.progress.stage).toBe('preparing');
    expect(result.current.error).toBe(null);
    // Settings should not be reset
    expect(result.current.settings.quality).toBe('low');
    expect(result.current.settings.fps).toBe(24);
  });
  
  it('maintains settings across reset', () => {
    const { result } = renderHook(() => useExportStore());
    
    act(() => {
      result.current.updateSettings({
        format: 'webm',
        quality: 'ultra',
        fps: 60,
        includeAudio: false
      });
    });
    
    const settingsBeforeReset = { ...result.current.settings };
    
    act(() => {
      result.current.resetExport();
    });
    
    expect(result.current.settings).toEqual(settingsBeforeReset);
  });
});