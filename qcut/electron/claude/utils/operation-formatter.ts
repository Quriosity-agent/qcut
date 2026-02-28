import type { EditorEvent } from "../../types/claude-api.js";
import {
	OPERATION_NOTIFICATION_SOURCE,
	type OperationNotification,
	type OperationNotificationSource,
	getNotifiableOperation,
} from "../../types/operation-notification.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	try {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	} catch {
		return false;
	}
}

function sanitizeInlineText({
	value,
}: {
	value: unknown;
}): string | undefined {
	try {
		if (typeof value !== "string") {
			return undefined;
		}
		const normalized = value.replace(/\s+/g, " ").trim();
		if (!normalized) {
			return undefined;
		}
		return normalized;
	} catch {
		return undefined;
	}
}

function sanitizeNumber({
	value,
}: {
	value: unknown;
}): number | undefined {
	try {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			return undefined;
		}
		return value;
	} catch {
		return undefined;
	}
}

function formatTimeOfDay({
	timestamp,
}: {
	timestamp: number;
}): string {
	try {
		return new Date(timestamp).toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "00:00:00";
	}
}

function formatTimelineTime({
	seconds,
}: {
	seconds: number;
}): string {
	try {
		const safeSeconds = Math.max(0, seconds);
		const totalMilliseconds = Math.round(safeSeconds * 1000);
		const minutes = Math.floor(totalMilliseconds / 60_000);
		const secondsPart = Math.floor((totalMilliseconds % 60_000) / 1000);
		const milliseconds = totalMilliseconds % 1000;
		return `${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
	} catch {
		return "00:00.000";
	}
}

function resolveNotificationSource({
	source,
}: {
	source: string;
}): OperationNotificationSource {
	try {
		const normalized = source.toLowerCase();
		if (normalized.includes("shortcut")) {
			return OPERATION_NOTIFICATION_SOURCE.shortcut;
		}
		if (normalized.startsWith("cli") || normalized.includes(".cli")) {
			return OPERATION_NOTIFICATION_SOURCE.cli;
		}
		return OPERATION_NOTIFICATION_SOURCE.gui;
	} catch {
		return OPERATION_NOTIFICATION_SOURCE.gui;
	}
}

function isUserInitiatedEvent({ event }: { event: EditorEvent }): boolean {
	try {
		if (event.category.startsWith("export.")) {
			return true;
		}

		const source = event.source.toLowerCase();
		if (source.startsWith("renderer.")) {
			return true;
		}
		if (source.includes("shortcut")) {
			return true;
		}
		if (source.startsWith("cli") || source.includes(".cli")) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

function getElementTypeLabel({
	value,
}: {
	value: unknown;
}): string {
	try {
		const normalized = sanitizeInlineText({ value })?.toLowerCase();
		if (normalized) {
			return normalized;
		}
		return "timeline";
	} catch {
		return "timeline";
	}
}

function getTextLabel({
	event,
}: {
	event: EditorEvent;
}): string | undefined {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const directContent = sanitizeInlineText({ value: data.content });
		if (directContent) {
			return directContent.slice(0, 80);
		}

		const element = isObjectRecord(data.element) ? data.element : null;
		if (!element) {
			return undefined;
		}
		const elementContent = sanitizeInlineText({ value: element.content });
		if (elementContent) {
			return elementContent.slice(0, 80);
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function buildTimelineAddedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const element = isObjectRecord(data.element) ? data.element : {};
		const elementType = getElementTypeLabel({
			value: element.type ?? data.trackType ?? "element",
		});
		const textLabel = getTextLabel({ event });
		const startTime = sanitizeNumber({
			value: element.startTime ?? data.startTime,
		});

		let summary = `User added ${elementType} element to timeline`;
		if (textLabel && elementType === "text") {
			summary = `User added text element "${textLabel}" to timeline`;
		}
		if (typeof startTime === "number") {
			summary = `${summary} at ${formatTimelineTime({ seconds: startTime })}`;
		}
		return summary;
	} catch {
		return "User added an element to timeline";
	}
}

function buildTimelineUpdatedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const after = isObjectRecord(data.after) ? data.after : {};
		const elementType = getElementTypeLabel({
			value: after.type ?? data.trackType ?? "timeline",
		});
		return `User updated ${elementType} element on timeline`;
	} catch {
		return "User updated an element on timeline";
	}
}

function buildTimelineRemovedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const element = isObjectRecord(data.element) ? data.element : {};
		const elementType = getElementTypeLabel({
			value: element.type ?? data.trackType ?? "timeline",
		});
		return `User removed ${elementType} element from timeline`;
	} catch {
		return "User removed an element from timeline";
	}
}

function buildMediaImportedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const mediaName = sanitizeInlineText({ value: data.name });
		if (mediaName) {
			return `User imported media file "${mediaName}"`;
		}
		return "User imported media";
	} catch {
		return "User imported media";
	}
}

function buildMediaDeletedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const mediaName = sanitizeInlineText({ value: data.name });
		if (mediaName) {
			return `User deleted media file "${mediaName}"`;
		}
		return "User deleted media";
	} catch {
		return "User deleted media";
	}
}

function buildExportStartedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const presetId = sanitizeInlineText({ value: data.presetId });
		if (presetId) {
			return `User started export (preset: "${presetId}")`;
		}
		return "User started export";
	} catch {
		return "User started export";
	}
}

function buildExportCompletedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const outputPath = sanitizeInlineText({ value: data.outputPath });
		if (outputPath) {
			return `Export completed: "${outputPath}"`;
		}
		return "Export completed";
	} catch {
		return "Export completed";
	}
}

function buildExportFailedSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const errorMessage = sanitizeInlineText({ value: data.error });
		if (errorMessage) {
			return `Export failed: ${errorMessage}`;
		}
		return "Export failed";
	} catch {
		return "Export failed";
	}
}

function buildProjectSettingsSummary({
	event,
}: {
	event: EditorEvent;
}): string {
	try {
		const data = isObjectRecord(event.data) ? event.data : {};
		const projectName = sanitizeInlineText({ value: data.name });
		if (projectName) {
			return `User updated project settings for "${projectName}"`;
		}
		return "User changed project settings";
	} catch {
		return "User changed project settings";
	}
}

function buildSummary({
	event,
	defaultSummary,
}: {
	event: EditorEvent;
	defaultSummary: string;
}): string {
	try {
		if (event.category === "timeline.elementAdded") {
			return buildTimelineAddedSummary({ event });
		}
		if (event.category === "timeline.elementUpdated") {
			return buildTimelineUpdatedSummary({ event });
		}
		if (event.category === "timeline.elementRemoved") {
			return buildTimelineRemovedSummary({ event });
		}
		if (event.category === "media.imported") {
			return buildMediaImportedSummary({ event });
		}
		if (event.category === "media.deleted") {
			return buildMediaDeletedSummary({ event });
		}
		if (event.category === "export.started") {
			return buildExportStartedSummary({ event });
		}
		if (event.category === "export.completed") {
			return buildExportCompletedSummary({ event });
		}
		if (event.category === "export.failed") {
			return buildExportFailedSummary({ event });
		}
		if (event.category === "project.settingsChanged") {
			return buildProjectSettingsSummary({ event });
		}
		return defaultSummary;
	} catch {
		return defaultSummary;
	}
}

export function toOperationNotification({
	event,
}: {
	event: EditorEvent;
}): OperationNotification | null {
	try {
		if (!isUserInitiatedEvent({ event })) {
			return null;
		}

		const operation = getNotifiableOperation({
			category: event.category,
			action: event.action,
		});
		if (!operation) {
			return null;
		}

		return {
			id: event.eventId,
			timestamp: event.timestamp,
			operation: operation.operation,
			summary: buildSummary({ event, defaultSummary: operation.defaultSummary }),
			details: isObjectRecord(event.data) ? event.data : {},
			source: resolveNotificationSource({ source: event.source }),
		};
	} catch {
		return null;
	}
}

export function formatOperationForTerminal({
	event,
}: {
	event: EditorEvent;
}): string | null {
	try {
		const notification = toOperationNotification({ event });
		if (!notification) {
			return null;
		}
		return `[QCut] ${formatTimeOfDay({ timestamp: notification.timestamp })} - ${notification.summary}`;
	} catch {
		return null;
	}
}
