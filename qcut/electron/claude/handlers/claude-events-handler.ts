/**
 * Claude editor events handler: in-memory event buffer + IPC ingest + subscriptions.
 * Keeps event streaming separate from the existing operation log.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { claudeLog } from "../utils/logger.js";
import type {
	EditorEvent,
	EditorEventAction,
	EventCategory,
	EventFilter,
} from "../../types/claude-api.js";
import { CLAUDE_EDITOR_EVENT_CATEGORY } from "../../types/claude-api.js";

const HANDLER_NAME = "Events";
const CLAUDE_EVENTS_EMITTED = "claude-events:emitted";
const MAX_EVENT_ENTRIES = 1000;

const claudeEventsEmitter = new EventEmitter();
claudeEventsEmitter.setMaxListeners(0);

const editorEvents: EditorEvent[] = [];

const allowedCategories = new Set<EventCategory>(
	Object.values(CLAUDE_EDITOR_EVENT_CATEGORY)
);

export interface ClaudeEventEmitInput {
	category: EventCategory;
	action?: EditorEventAction;
	correlationId?: string;
	data?: Record<string, unknown>;
	source: string;
	eventId?: string;
	timestamp?: number;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	try {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	} catch {
		return false;
	}
}

function createEventId(): string {
	try {
		return `evt_${Date.now()}_${randomUUID()}`;
	} catch {
		return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	}
}

function getActionFromCategory({
	category,
}: {
	category: EventCategory;
}): EditorEventAction {
	try {
		const action = category.split(".").slice(-1)[0];
		return action as EditorEventAction;
	} catch {
		return "failed";
	}
}

function normalizeLimit({ limit }: { limit?: number }): number {
	try {
		if (!Number.isFinite(limit) || typeof limit !== "number") {
			return 100;
		}
		const intLimit = Math.trunc(limit);
		if (intLimit <= 0) {
			return 100;
		}
		return Math.min(intLimit, MAX_EVENT_ENTRIES);
	} catch {
		return 100;
	}
}

function matchesCategoryFilter({
	event,
	category,
}: {
	event: EditorEvent;
	category?: string;
}): boolean {
	try {
		if (!category) {
			return true;
		}

		const trimmedCategory = category.trim();
		if (!trimmedCategory) {
			return true;
		}

		if (event.category === trimmedCategory) {
			return true;
		}

		return event.category.startsWith(`${trimmedCategory}.`);
	} catch {
		return true;
	}
}

function matchesSourceFilter({
	event,
	source,
}: {
	event: EditorEvent;
	source?: string;
}): boolean {
	try {
		if (!source) {
			return true;
		}
		const trimmedSource = source.trim();
		if (!trimmedSource) {
			return true;
		}
		return event.source === trimmedSource;
	} catch {
		return true;
	}
}

function pruneEvents(): void {
	try {
		if (editorEvents.length <= MAX_EVENT_ENTRIES) {
			return;
		}
		const overflow = editorEvents.length - MAX_EVENT_ENTRIES;
		editorEvents.splice(0, overflow);
	} catch {
		// no-op
	}
}

function sanitizeRendererEventPayload({
	payload,
}: {
	payload: unknown;
}): ClaudeEventEmitInput | null {
	try {
		if (!isObjectRecord(payload)) {
			return null;
		}

		const category = payload.category;
		const source = payload.source;

		if (
			typeof category !== "string" ||
			!allowedCategories.has(category as EventCategory)
		) {
			return null;
		}

		if (typeof source !== "string" || !source.trim()) {
			return null;
		}

		const data = isObjectRecord(payload.data) ? payload.data : {};
		const eventId =
			typeof payload.eventId === "string" ? payload.eventId : undefined;
		const timestamp =
			typeof payload.timestamp === "number" &&
			Number.isFinite(payload.timestamp)
				? payload.timestamp
				: undefined;
		const correlationId =
			typeof payload.correlationId === "string"
				? payload.correlationId
				: undefined;
		const action =
			typeof payload.action === "string"
				? (payload.action as EditorEventAction)
				: undefined;

		return {
			category: category as EventCategory,
			action,
			correlationId,
			data,
			source: source.trim(),
			eventId,
			timestamp,
		};
	} catch {
		return null;
	}
}

export function emitClaudeEvent(input: ClaudeEventEmitInput): EditorEvent {
	try {
		if (!allowedCategories.has(input.category)) {
			throw new Error(`Unsupported event category: ${input.category}`);
		}

		const action =
			input.action ?? getActionFromCategory({ category: input.category });
		const timestamp =
			typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
				? input.timestamp
				: Date.now();
		const nextEvent: EditorEvent = {
			eventId: input.eventId?.trim() ? input.eventId : createEventId(),
			timestamp,
			category: input.category,
			action,
			correlationId: input.correlationId?.trim()
				? input.correlationId
				: undefined,
			data: isObjectRecord(input.data) ? input.data : {},
			source: input.source,
		};

		editorEvents.push(nextEvent);
		pruneEvents();
		claudeEventsEmitter.emit(CLAUDE_EVENTS_EMITTED, nextEvent);
		return nextEvent;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown emit error";
		claudeLog.warn(HANDLER_NAME, `Failed to emit event: ${message}`);
		throw error instanceof Error ? error : new Error(message);
	}
}

export function getClaudeEvents({
	limit,
	category,
	after,
	source,
}: EventFilter = {}): EditorEvent[] {
	try {
		let filtered = [...editorEvents];

		if (after && after.trim()) {
			const index = filtered.findIndex((event) => event.eventId === after);
			if (index >= 0) {
				filtered = filtered.slice(index + 1);
			}
		}

		filtered = filtered.filter((event) => {
			return (
				matchesCategoryFilter({ event, category }) &&
				matchesSourceFilter({ event, source })
			);
		});

		const resolvedLimit = normalizeLimit({ limit });
		if (filtered.length > resolvedLimit) {
			return filtered.slice(-resolvedLimit);
		}

		return filtered;
	} catch {
		return [];
	}
}

export function subscribeClaudeEvents({
	listener,
}: {
	listener: (event: EditorEvent) => void;
}): () => void {
	try {
		const wrapped = (event: EditorEvent) => {
			try {
				listener(event);
			} catch {
				// no-op
			}
		};

		claudeEventsEmitter.on(CLAUDE_EVENTS_EMITTED, wrapped);
		return () => {
			try {
				claudeEventsEmitter.removeListener(CLAUDE_EVENTS_EMITTED, wrapped);
			} catch {
				// no-op
			}
		};
	} catch {
		return () => {
			// no-op
		};
	}
}

export function clearClaudeEventsForTests(): void {
	try {
		editorEvents.length = 0;
	} catch {
		// no-op
	}
}

export function setupClaudeEventsIPC(): void {
	try {
		ipcMain.removeAllListeners("claude:events:emit");
		ipcMain.on("claude:events:emit", (_event, payload: unknown) => {
			try {
				const parsed = sanitizeRendererEventPayload({ payload });
				if (!parsed) {
					return;
				}
				emitClaudeEvent(parsed);
			} catch (error) {
				claudeLog.warn(HANDLER_NAME, "Failed to ingest renderer event:", error);
			}
		});

		claudeLog.info(HANDLER_NAME, "Claude events IPC registered");
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to setup Claude events IPC:", error);
	}
}

module.exports = {
	setupClaudeEventsIPC,
	emitClaudeEvent,
	getClaudeEvents,
	subscribeClaudeEvents,
	clearClaudeEventsForTests,
};
