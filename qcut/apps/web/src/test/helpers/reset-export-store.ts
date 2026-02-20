import { useExportStore } from "@/stores/export-store";

export function resetExportStore() {
	useExportStore.setState({
		isDialogOpen: false,
		progress: {
			progress: 0,
			status: "",
			isExporting: false,
			currentFrame: 0,
			totalFrames: 0,
			estimatedTimeRemaining: 0,
		},
		error: null,
	});
}
