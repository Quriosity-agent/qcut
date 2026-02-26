/**
 * Editor event stream types for Claude integrations.
 */

export const CLAUDE_EDITOR_EVENT_CATEGORY = {
	timelineElementAdded: "timeline.elementAdded",
	timelineElementRemoved: "timeline.elementRemoved",
	timelineElementUpdated: "timeline.elementUpdated",
	mediaImported: "media.imported",
	mediaDeleted: "media.deleted",
	exportStarted: "export.started",
	exportProgress: "export.progress",
	exportCompleted: "export.completed",
	exportFailed: "export.failed",
	projectSettingsChanged: "project.settingsChanged",
	editorSelectionChanged: "editor.selectionChanged",
	editorPlayheadMoved: "editor.playheadMoved",
} as const;

export type EventCategory =
	(typeof CLAUDE_EDITOR_EVENT_CATEGORY)[keyof typeof CLAUDE_EDITOR_EVENT_CATEGORY];

export const CLAUDE_EDITOR_EVENT_ACTION = {
	elementAdded: "elementAdded",
	elementRemoved: "elementRemoved",
	elementUpdated: "elementUpdated",
	imported: "imported",
	deleted: "deleted",
	started: "started",
	progress: "progress",
	completed: "completed",
	failed: "failed",
	settingsChanged: "settingsChanged",
	selectionChanged: "selectionChanged",
	playheadMoved: "playheadMoved",
} as const;

export type EditorEventAction =
	(typeof CLAUDE_EDITOR_EVENT_ACTION)[keyof typeof CLAUDE_EDITOR_EVENT_ACTION];

export interface EditorEvent {
	eventId: string;
	timestamp: number;
	category: EventCategory;
	action: EditorEventAction;
	correlationId?: string;
	data: Record<string, unknown>;
	source: string;
}

export interface EventFilter {
	limit?: number;
	category?: string;
	after?: string;
	source?: string;
}

