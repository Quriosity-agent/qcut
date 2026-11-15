import { debugError, debugWarn } from "@/lib/debug/debug-config";
import { platform } from "@qcut/platform-core";
import { useEditorStore } from "@/stores/editor/editor-store";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useMediaStore, type MediaItem } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";
import {
	createTimelineSnapshotter,
	diffTimelineSnapshots,
	snapshotElementData,
} from "./claude-events-timeline-snapshot";
import {
	CLAUDE_EDITOR_EVENT_ACTION,
	CLAUDE_EDITOR_EVENT_CATEGORY,
	type EditorEvent,
	type EventCategory,
} from "../../../../../electron/types/claude-api";

type EmitPayload = Omit<EditorEvent, "eventId" | "timestamp"> &
	Partial<Pick<EditorEvent, "eventId" | "timestamp">>;

type UnsubscribeFn = () => void;

interface MediaItemSnapshot {
	id: string;
	name: string;
	type: string;
	localPath?: string;
	url?: string;
	size?: number;
}

interface ProjectSettingsSnapshot {
	projectId: string | null;
	name: string | null;
	backgroundColor: string | null;
	backgroundType: string | null;
	blurIntensity: number | null;
	fps: number | null;
	canvasWidth: number | null;
	canvasHeight: number | null;
	canvasMode: string | null;
}

interface EditorCanvasSnapshot {
	canvasWidth: number;
	canvasHeight: number;
	canvasMode: string;
}

interface PlayheadSample {
	time: number;
	timestamp: number;
}

const bridgeState = {
	isSetup: false,
	unsubscribes: [] as UnsubscribeFn[],
	playheadTimer: null as number | null,
	playheadSamples: [] as PlayheadSample[],
	lastPlayheadTime: null as number | null,
};

function buildMediaSnapshotMap(): Map<string, MediaItemSnapshot> {
	const snapshot = new Map<string, MediaItemSnapshot>();

	try {
		const { mediaItems } = useMediaStore.getState();
		for (const item of mediaItems) {
			snapshot.set(item.id, buildMediaItemSnapshot({ item }));
		}
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to snapshot media", error);
	}

	return snapshot;
}

function buildMediaItemSnapshot({
	item,
}: {
	item: MediaItem;
}): MediaItemSnapshot {
	try {
		return {
			id: item.id,
			name: item.name,
			type: item.type,
			localPath: item.localPath,
			url: item.url,
		};
	} catch {
		return {
			id: item.id,
			name: item.name,
			type: item.type,
		};
	}
}

function getSelectionSnapshot(): string {
	try {
		const selectedElements = [...useTimelineStore.getState().selectedElements];
		selectedElements.sort((left, right) => {
			if (left.trackId !== right.trackId) {
				return left.trackId.localeCompare(right.trackId);
			}
			return left.elementId.localeCompare(right.elementId);
		});
		return JSON.stringify(selectedElements);
	} catch {
		return "[]";
	}
}

function buildProjectSettingsSnapshot(): ProjectSettingsSnapshot {
	try {
		const activeProject = useProjectStore.getState().activeProject;
		if (!activeProject) {
			return {
				projectId: null,
				name: null,
				backgroundColor: null,
				backgroundType: null,
				blurIntensity: null,
				fps: null,
				canvasWidth: null,
				canvasHeight: null,
				canvasMode: null,
			};
		}

		return {
			projectId: activeProject.id,
			name: activeProject.name ?? null,
			backgroundColor: activeProject.backgroundColor ?? null,
			backgroundType: activeProject.backgroundType ?? null,
			blurIntensity:
				typeof activeProject.blurIntensity === "number"
					? activeProject.blurIntensity
					: null,
			fps: typeof activeProject.fps === "number" ? activeProject.fps : null,
			canvasWidth: activeProject.canvasSize?.width ?? null,
			canvasHeight: activeProject.canvasSize?.height ?? null,
			canvasMode: activeProject.canvasMode ?? null,
		};
	} catch {
		return {
			projectId: null,
			name: null,
			backgroundColor: null,
			backgroundType: null,
			blurIntensity: null,
			fps: null,
			canvasWidth: null,
			canvasHeight: null,
			canvasMode: null,
		};
	}
}

function buildEditorCanvasSnapshot(): EditorCanvasSnapshot {
	try {
		const state = useEditorStore.getState();
		return {
			canvasWidth: state.canvasSize.width,
			canvasHeight: state.canvasSize.height,
			canvasMode: state.canvasMode,
		};
	} catch {
		return {
			canvasWidth: 0,
			canvasHeight: 0,
			canvasMode: "preset",
		};
	}
}

/**
 * Access the Claude events API exposed by the platform runtime.
 *
 * @returns The Claude events API object if available, `undefined` otherwise.
 */
function getClaudeEventsApi() {
	try {
		return platform().claude?.events;
	} catch {
		return undefined;
	}
}

function emitClaudeRendererEvent({
	category,
	action,
	data,
	source,
	correlationId,
}: {
	category: EventCategory;
	action: EditorEvent["action"];
	data: Record<string, unknown>;
	source: string;
	correlationId?: string;
}): void {
	try {
		const api = getClaudeEventsApi();
		if (!api?.emit) {
			return;
		}

		const payload: EmitPayload = {
			category,
			action,
			data,
			source,
			correlationId,
		};

		api.emit(payload);
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to emit renderer event", error);
	}
}

function getActiveProjectId(): string | null {
	try {
		return useProjectStore.getState().activeProject?.id ?? null;
	} catch {
		return null;
	}
}

function flushPlayheadBatch(): void {
	try {
		if (bridgeState.playheadTimer !== null) {
			window.clearTimeout(bridgeState.playheadTimer);
			bridgeState.playheadTimer = null;
		}

		if (bridgeState.playheadSamples.length === 0) {
			return;
		}

		const samples = [...bridgeState.playheadSamples];
		bridgeState.playheadSamples = [];
		const latestSample = samples[samples.length - 1];
		const isPlaying = usePlaybackStore.getState().isPlaying;

		emitClaudeRendererEvent({
			category: CLAUDE_EDITOR_EVENT_CATEGORY.editorPlayheadMoved,
			action: CLAUDE_EDITOR_EVENT_ACTION.playheadMoved,
			source: "renderer.playback-store",
			data: {
				projectId: getActiveProjectId(),
				currentTime: latestSample.time,
				isPlaying,
				sampleCount: samples.length,
				samples,
			},
		});
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to flush playhead batch", error);
	}
}

function schedulePlayheadFlush(): void {
	try {
		if (bridgeState.playheadTimer !== null) {
			return;
		}

		bridgeState.playheadTimer = window.setTimeout(() => {
			flushPlayheadBatch();
		}, 100);
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to schedule playhead batch", error);
	}
}

function setupTimelineSubscriptions(): void {
	const snapshotTimeline = createTimelineSnapshotter();
	let previousTracks = useTimelineStore.getState().tracks;
	let previousTimeline = snapshotTimeline({ tracks: previousTracks });
	let previousSelection = getSelectionSnapshot();

	const emitTimelineChanges = ({ tracks }: { tracks: TimelineTrack[] }) => {
		const nextTimeline = snapshotTimeline({ tracks });
		const { added, updated, removed } = diffTimelineSnapshots({
			previous: previousTimeline,
			next: nextTimeline,
		});
		previousTimeline = nextTimeline;
		const projectId = getActiveProjectId();
		for (const snapshot of added) {
			emitClaudeRendererEvent({
				category: CLAUDE_EDITOR_EVENT_CATEGORY.timelineElementAdded,
				action: CLAUDE_EDITOR_EVENT_ACTION.elementAdded,
				source: "renderer.timeline-store",
				data: {
					projectId,
					elementId: snapshot.elementId,
					trackId: snapshot.trackId,
					trackType: snapshot.trackType,
					element: snapshotElementData({ snapshot }),
				},
			});
		}
		for (const { before, after } of updated) {
			emitClaudeRendererEvent({
				category: CLAUDE_EDITOR_EVENT_CATEGORY.timelineElementUpdated,
				action: CLAUDE_EDITOR_EVENT_ACTION.elementUpdated,
				source: "renderer.timeline-store",
				data: {
					projectId,
					elementId: after.elementId,
					trackId: after.trackId,
					trackType: after.trackType,
					before: snapshotElementData({ snapshot: before }),
					after: snapshotElementData({ snapshot: after }),
				},
			});
		}
		for (const snapshot of removed) {
			emitClaudeRendererEvent({
				category: CLAUDE_EDITOR_EVENT_CATEGORY.timelineElementRemoved,
				action: CLAUDE_EDITOR_EVENT_ACTION.elementRemoved,
				source: "renderer.timeline-store",
				data: {
					projectId,
					elementId: snapshot.elementId,
					trackId: snapshot.trackId,
					trackType: snapshot.trackType,
					element: snapshotElementData({ snapshot }),
				},
			});
		}
	};

	const unsubscribe = useTimelineStore.subscribe((state) => {
		try {
			// The store sets a new `tracks` array only when the timeline
			// changed; selection, save status and the like leave it alone.
			if (state.tracks !== previousTracks) {
				previousTracks = state.tracks;
				emitTimelineChanges({ tracks: state.tracks });
			}
			const projectId = getActiveProjectId();

			const nextSelection = getSelectionSnapshot();
			if (nextSelection !== previousSelection) {
				previousSelection = nextSelection;
				emitClaudeRendererEvent({
					category: CLAUDE_EDITOR_EVENT_CATEGORY.editorSelectionChanged,
					action: CLAUDE_EDITOR_EVENT_ACTION.selectionChanged,
					source: "renderer.timeline-store",
					data: {
						projectId,
						selectedElements: state.selectedElements,
					},
				});
			}
		} catch (error) {
			debugError("[ClaudeEventsBridge] Timeline subscription failed", error);
		}
	});

	bridgeState.unsubscribes.push(unsubscribe);
}

function setupMediaSubscriptions(): void {
	let previousMedia = buildMediaSnapshotMap();

	const unsubscribe = useMediaStore.subscribe((state) => {
		try {
			const nextMedia = new Map<string, MediaItemSnapshot>();
			for (const item of state.mediaItems) {
				nextMedia.set(item.id, buildMediaItemSnapshot({ item }));
			}

			const projectId = getActiveProjectId();

			for (const [mediaId, nextSnapshot] of nextMedia) {
				if (previousMedia.has(mediaId)) {
					continue;
				}

				emitClaudeRendererEvent({
					category: CLAUDE_EDITOR_EVENT_CATEGORY.mediaImported,
					action: CLAUDE_EDITOR_EVENT_ACTION.imported,
					source: "renderer.media-store",
					data: {
						projectId,
						mediaId,
						...nextSnapshot,
					},
				});
			}

			for (const [mediaId, previousSnapshot] of previousMedia) {
				if (nextMedia.has(mediaId)) {
					continue;
				}

				emitClaudeRendererEvent({
					category: CLAUDE_EDITOR_EVENT_CATEGORY.mediaDeleted,
					action: CLAUDE_EDITOR_EVENT_ACTION.deleted,
					source: "renderer.media-store",
					data: {
						projectId,
						mediaId,
						...previousSnapshot,
					},
				});
			}

			previousMedia = nextMedia;
		} catch (error) {
			debugError("[ClaudeEventsBridge] Media subscription failed", error);
		}
	});

	bridgeState.unsubscribes.push(unsubscribe);
}

function setupProjectSubscriptions(): void {
	let previousProjectSettings = JSON.stringify(buildProjectSettingsSnapshot());
	let previousEditorCanvas = JSON.stringify(buildEditorCanvasSnapshot());

	const unsubscribeProject = useProjectStore.subscribe(() => {
		try {
			const snapshot = buildProjectSettingsSnapshot();
			const nextJson = JSON.stringify(snapshot);
			if (nextJson === previousProjectSettings) {
				return;
			}

			previousProjectSettings = nextJson;
			emitClaudeRendererEvent({
				category: CLAUDE_EDITOR_EVENT_CATEGORY.projectSettingsChanged,
				action: CLAUDE_EDITOR_EVENT_ACTION.settingsChanged,
				source: "renderer.project-store",
				data: snapshot as unknown as Record<string, unknown>,
			});
		} catch (error) {
			debugError("[ClaudeEventsBridge] Project subscription failed", error);
		}
	});

	const unsubscribeEditor = useEditorStore.subscribe(() => {
		try {
			const snapshot = buildEditorCanvasSnapshot();
			const nextJson = JSON.stringify(snapshot);
			if (nextJson === previousEditorCanvas) {
				return;
			}

			previousEditorCanvas = nextJson;
			emitClaudeRendererEvent({
				category: CLAUDE_EDITOR_EVENT_CATEGORY.projectSettingsChanged,
				action: CLAUDE_EDITOR_EVENT_ACTION.settingsChanged,
				source: "renderer.editor-store",
				data: {
					projectId: getActiveProjectId(),
					editorCanvas: snapshot,
				},
			});
		} catch (error) {
			debugError("[ClaudeEventsBridge] Editor subscription failed", error);
		}
	});

	bridgeState.unsubscribes.push(unsubscribeProject, unsubscribeEditor);
}

function setupPlaybackSubscriptions(): void {
	const unsubscribe = usePlaybackStore.subscribe((state) => {
		try {
			if (bridgeState.lastPlayheadTime === state.currentTime) {
				return;
			}

			bridgeState.lastPlayheadTime = state.currentTime;
			bridgeState.playheadSamples.push({
				time: state.currentTime,
				timestamp: Date.now(),
			});
			schedulePlayheadFlush();
		} catch (error) {
			debugError("[ClaudeEventsBridge] Playback subscription failed", error);
		}
	});

	bridgeState.unsubscribes.push(unsubscribe);
}

export function setupClaudeEventsBridge(): void {
	try {
		if (bridgeState.isSetup) {
			return;
		}

		const api = getClaudeEventsApi();
		if (!api?.emit) {
			debugWarn("[ClaudeEventsBridge] Claude events API not available");
			return;
		}

		setupTimelineSubscriptions();
		setupMediaSubscriptions();
		setupProjectSubscriptions();
		setupPlaybackSubscriptions();

		bridgeState.isSetup = true;
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to setup", error);
	}
}

export function cleanupClaudeEventsBridge(): void {
	try {
		for (const unsubscribe of bridgeState.unsubscribes.splice(0)) {
			try {
				unsubscribe();
			} catch (error) {
				debugError("[ClaudeEventsBridge] Failed to unsubscribe", error);
			}
		}

		if (bridgeState.playheadTimer !== null) {
			window.clearTimeout(bridgeState.playheadTimer);
			bridgeState.playheadTimer = null;
		}
		bridgeState.playheadSamples = [];
		bridgeState.lastPlayheadTime = null;
		bridgeState.isSetup = false;
	} catch (error) {
		debugError("[ClaudeEventsBridge] Failed to cleanup", error);
	}
}
