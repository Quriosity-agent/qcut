import { useMediaStore } from "@/stores/media/media-store";

export function resetMediaStore() {
	useMediaStore.setState({
		mediaItems: [],
		isLoading: false,
	});
}
