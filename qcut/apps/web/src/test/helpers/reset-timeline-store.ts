import { useTimelineStore } from '@/stores/timeline-store';

export function resetTimelineStore() {
  const store = useTimelineStore.getState();
  if (store.clearTimeline) {
    store.clearTimeline();
  } else {
    useTimelineStore.setState({
      tracks: [],
      history: [],
      historyIndex: -1,
    });
  }
}