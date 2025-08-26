import { useExportStore } from '@/stores/export-store';

export function resetExportStore() {
  useExportStore.setState({
    isDialogOpen: false,
    progress: { percentage: 0, message: '', isExporting: false },
    error: null,
  });
}