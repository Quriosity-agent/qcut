import type { EditorEventAction, EventCategory } from "./claude-events-api.js";

export const OPERATION_NOTIFICATION_SOURCE = {
	gui: "gui",
	cli: "cli",
	shortcut: "shortcut",
} as const;

export type OperationNotificationSource =
	(typeof OPERATION_NOTIFICATION_SOURCE)[keyof typeof OPERATION_NOTIFICATION_SOURCE];

export interface OperationNotification {
	id: string;
	timestamp: number;
	operation: string;
	summary: string;
	details?: Record<string, unknown>;
	source: OperationNotificationSource;
}

export interface NotifiableOperationDefinition {
	operation: string;
	category: EventCategory;
	action: EditorEventAction;
	defaultSummary: string;
}

export const NOTIFIABLE_OPERATIONS = [
	{
		operation: "timeline.addElement",
		category: "timeline.elementAdded",
		action: "elementAdded",
		defaultSummary: "User added an element to timeline",
	},
	{
		operation: "timeline.updateElement",
		category: "timeline.elementUpdated",
		action: "elementUpdated",
		defaultSummary: "User updated an element on timeline",
	},
	{
		operation: "timeline.removeElement",
		category: "timeline.elementRemoved",
		action: "elementRemoved",
		defaultSummary: "User removed an element from timeline",
	},
	{
		operation: "media.import",
		category: "media.imported",
		action: "imported",
		defaultSummary: "User imported media",
	},
	{
		operation: "media.delete",
		category: "media.deleted",
		action: "deleted",
		defaultSummary: "User deleted media",
	},
	{
		operation: "export.start",
		category: "export.started",
		action: "started",
		defaultSummary: "User started export",
	},
	{
		operation: "export.complete",
		category: "export.completed",
		action: "completed",
		defaultSummary: "Export completed",
	},
	{
		operation: "export.fail",
		category: "export.failed",
		action: "failed",
		defaultSummary: "Export failed",
	},
	{
		operation: "project.updateSettings",
		category: "project.settingsChanged",
		action: "settingsChanged",
		defaultSummary: "User changed project settings",
	},
] as const satisfies readonly NotifiableOperationDefinition[];

export const NOTIFIABLE_EVENT_CATEGORIES = [
	"timeline.elementAdded",
	"timeline.elementUpdated",
	"timeline.elementRemoved",
	"media.imported",
	"media.deleted",
	"export.started",
	"export.completed",
	"export.failed",
	"project.settingsChanged",
] as const satisfies readonly EventCategory[];

function createOperationKey({
	category,
	action,
}: {
	category: EventCategory;
	action: EditorEventAction;
}): string {
	try {
		return `${category}::${action}`;
	} catch {
		return "unknown::unknown";
	}
}

const notifiableOperationMap = new Map<string, NotifiableOperationDefinition>();
for (const operation of NOTIFIABLE_OPERATIONS) {
	try {
		notifiableOperationMap.set(
			createOperationKey({
				category: operation.category,
				action: operation.action,
			}),
			operation
		);
	} catch {
		// no-op
	}
}

export function getNotifiableOperation({
	category,
	action,
}: {
	category: EventCategory;
	action: EditorEventAction;
}): NotifiableOperationDefinition | null {
	try {
		return (
			notifiableOperationMap.get(createOperationKey({ category, action })) ??
			null
		);
	} catch {
		return null;
	}
}
