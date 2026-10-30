/**
 * `editor:timeline:arrange`: lays a track's elements out one after another,
 * in time order or a given order, with an optional gap.
 *
 * @module lib/claude-bridge/claude-timeline-bridge-arrange
 */

import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { ClaudeArrangeResponse } from "../../../../../electron/types/claude-api";
import { debugError } from "@/lib/debug/debug-config";
import { getTimelineElementDuration } from "@/lib/timeline";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";

export function setupArrangeHandler({
	claudeAPI,
}: {
	claudeAPI: ClaudeTimelineBridgeAPI;
}): void {
	if (
		typeof claudeAPI.onArrange === "function" &&
		typeof claudeAPI.sendArrangeResponse === "function"
	) {
		claudeAPI.onArrange((data: any) => {
			try {
				const timelineStore = useTimelineStore.getState();
				const track = timelineStore.tracks.find(
					(candidate) => candidate.id === data.request.trackId
				);

				if (!track || track.elements.length === 0) {
					claudeAPI.sendArrangeResponse(data.requestId, { arranged: [] });
					return;
				}

				const requestMode = data.request.mode;
				const startOffset =
					typeof data.request.startOffset === "number" &&
					data.request.startOffset >= 0
						? data.request.startOffset
						: 0;
				const gap =
					typeof data.request.gap === "number" && data.request.gap >= 0
						? data.request.gap
						: requestMode === "spaced"
							? 0.5
							: 0;

				const byStartTime = [...track.elements].sort(
					(left, right) => left.startTime - right.startTime
				);

				let orderedElements = byStartTime;
				if (requestMode === "manual" && data.request.order?.length) {
					const elementsById = new Map(
						byStartTime.map((element) => [element.id, element])
					);
					const manualOrder: typeof byStartTime = [];

					for (const elementId of data.request.order) {
						const element = elementsById.get(elementId);
						if (!element) {
							continue;
						}
						manualOrder.push(element);
						elementsById.delete(elementId);
					}

					orderedElements = [...manualOrder, ...elementsById.values()];
				}

				const arranged: ClaudeArrangeResponse["arranged"] = [];
				const startTimes: Record<string, number> = {};
				let currentStartTime = startOffset;
				for (const element of orderedElements) {
					startTimes[element.id] = currentStartTime;
					arranged.push({
						elementId: element.id,
						newStartTime: currentStartTime,
					});
					currentStartTime += getTimelineElementDuration({ element }) + gap;
				}

				// One commit for the whole lane. Moving elements one at a time would
				// trip the one-element-per-position rule on intermediate states, so
				// arranging an already-stacked track — the reason to run this — would
				// silently do nothing.
				const applied = timelineStore.setTrackElementStartTimes(
					track.id,
					startTimes
				);

				claudeAPI.sendArrangeResponse(data.requestId, {
					arranged: applied ? arranged : [],
				});
			} catch (error) {
				debugError("[ClaudeTimelineBridge] Failed to arrange track:", error);
				claudeAPI.sendArrangeResponse(data.requestId, { arranged: [] });
			}
		});
	}
}
