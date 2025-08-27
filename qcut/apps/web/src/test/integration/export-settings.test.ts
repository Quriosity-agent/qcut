import { describe, it, expect, beforeEach } from 'vitest';
import { useExportStore } from '@/stores/export-store';
import { getExportSettings } from '@/test/utils/export-helpers';
import { ExportFormat, ExportQuality } from '@/types/export';

describe('Export Settings', () => {
  beforeEach(() => {
    useExportStore.setState({
      settings: {
        format: ExportFormat.WEBM,
        quality: ExportQuality.HIGH,
        filename: 'test.webm',
        width: 1920,
        height: 1080,
      },
    });
  });
  
  it('validates export settings', () => {
    const settings = getExportSettings();
    expect(settings.format).toBe(ExportFormat.WEBM);
    expect(settings.quality).toBe(ExportQuality.HIGH);
    expect(settings.resolution).toBe('1920x1080');
    expect(settings.fps).toBe(30);
  });
  
  it('updates export format', () => {
    useExportStore.setState({
      settings: {
        ...useExportStore.getState().settings,
        format: ExportFormat.MP4,
      },
    });
    const settings = getExportSettings();
    expect(settings.format).toBe(ExportFormat.MP4);
  });
});