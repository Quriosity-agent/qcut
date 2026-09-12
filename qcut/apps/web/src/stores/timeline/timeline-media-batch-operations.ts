import {
	planMediaBatchEdit,
	type MediaBatchEdit,
} from "@/lib/video/media-batch-properties";
import { blockedByTrackLock } from "./timeline-lock-guard";
import type { OperationDeps, StoreGet } from "./timeline-store-operations";

export function createMediaBatchOperations({
	get,
	deps,
}: {
	get: StoreGet;
	deps: Pick<OperationDeps, "getProjectFps" | "updateTracksAndSave">;
}) {
	return {
		updateMediaPropertiesBatch: (edit: MediaBatchEdit): number => {
			const tracks = get()._tracks;
			if (
				blockedByTrackLock({
					tracks,
					operation: "Update Selected Video Properties",
					trackIds: edit.elements.map(({ trackId }) => trackId),
				})
			)
				return 0;
			const result = planMediaBatchEdit({
				tracks,
				edit,
				fps: deps.getProjectFps(),
			});
			if (result.updatedCount === 0) return 0;
			get().pushHistory();
			deps.updateTracksAndSave(result.tracks);
			return result.updatedCount;
		},
	};
}
