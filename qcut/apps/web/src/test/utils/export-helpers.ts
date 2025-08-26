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
  const store = useExportStore.getState();
  return {
    format: store.format || 'WEBM',
    quality: store.quality || 0.92,
    resolution: store.resolution || '1920x1080',
    fps: store.fps || 30,
  };
}