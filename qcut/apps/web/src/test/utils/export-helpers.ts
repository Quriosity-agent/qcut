import { useExportStore } from '@/stores/export-store';
import { waitForCondition } from './async-helpers';

export async function waitForExportComplete(
  timeout = 30000
): Promise<void> {
  const store = useExportStore.getState();
  
  await waitForCondition(
    () => !store.progress.isExporting && store.progress.percentage === 100,
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

export function getExportSettings() {
  const { settings } = useExportStore.getState();
  return {
    format: settings.format,
    quality: settings.quality,
    resolution: `${settings.width}x${settings.height}`,
    fps: settings.fps,
  };
}