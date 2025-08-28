import { useMediaStore } from "@/stores/media-store";

export function resetMediaStore() {
  useMediaStore.setState({
    mediaItems: [],
    isLoading: false,
  });
}
