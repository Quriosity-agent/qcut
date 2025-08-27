import { useExportStore } from '@/stores/export-store';
import { ExportFormat, ExportQuality } from '@/types/export';
import { waitForCondition } from './async-helpers';

export async function waitForExportComplete(
  timeout = 30000
): Promise<void> {
  await waitForCondition(
    () => {
      const { progress } = useExportStore.getState();
      return !progress.isExporting && progress.percentage >= 100;
    },
    {
      timeout,
      message: 'Export did not complete',
    }
  );
}

export function mockExportProgress(
  percentage: number,
  message = 'Exporting...'
) {
  useExportStore.setState({
    progress: {
      percentage,
      message,
      isExporting: percentage < 100,
    },
  });
}

const DEFAULT_FPS = 30;

export type ExportSettingsSnapshot = {
  format: ExportFormat;
  quality: ExportQuality;
  resolution: string;
  fps: number;
};

export function getExportSettings(): ExportSettingsSnapshot {
  const { settings } = useExportStore.getState();
  return {
    format: settings.format ?? ExportFormat.WEBM,
    quality: settings.quality ?? ExportQuality.HIGH,
    resolution: `${settings.width ?? 1920}x${settings.height ?? 1080}`,
    fps: DEFAULT_FPS,
  };
}