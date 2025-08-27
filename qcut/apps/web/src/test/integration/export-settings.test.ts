import { describe, it, expect, beforeEach } from 'vitest';
import { useExportStore } from '@/stores/export-store';
import { getExportSettings } from '@/test/utils/export-helpers';

describe('Export Settings', () => {
  beforeEach(() => {
    useExportStore.setState({
      format: 'WEBM',
      quality: 0.92,
      resolution: '1920x1080',
      fps: 30,
    });
  });
  
  it('validates export settings', () => {
    const settings = getExportSettings();
    expect(settings.format).toBe('WEBM');
    expect(settings.quality).toBe(0.92);
    expect(settings.resolution).toBe('1920x1080');
    expect(settings.fps).toBe(30);
  });
  
  it('updates export format', () => {
    useExportStore.setState({ format: 'MP4' });
    const settings = getExportSettings();
    expect(settings.format).toBe('MP4');
  });
});