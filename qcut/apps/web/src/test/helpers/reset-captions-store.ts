import { useCaptionsStore } from '@/stores/captions-store';

export function resetCaptionsStore() {
  useCaptionsStore.setState({
    captions: [],
    selectedCaptionId: null,
    isGenerating: false,
  });
}