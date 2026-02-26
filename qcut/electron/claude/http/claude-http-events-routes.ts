import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";
import type { Router } from "../utils/http-router.js";
import type { EditorEvent, EventFilter } from "../../types/claude-api.js";

const DEFAULT_EVENTS_LIMIT = 100;
const MAX_EVENTS_LIMIT = 1000;
const DEFAULT_SSE_POLL_MS = 100;
const SSE_HEARTBEAT_MS = 15_000;

type ListEventsFn = (filter: EventFilter) => Promise<EditorEvent[]> | EditorEvent[];

type SubscribeEventsFn = (args: {
	listener: (event: EditorEvent) => void;
}) => () => void;

interface ClaudeEventsRouteOptions {
	listEvents: ListEventsFn;
}

interface ClaudeEventsStreamOptions extends ClaudeEventsRouteOptions {
	req: IncomingMessage;
	res: ServerResponse;
	subscribeToEvents?: SubscribeEventsFn;
	pollIntervalMs?: number;
}

function parseLimit({
	value,
}: {
	value?: string;
}): number | undefined {
	try {
		if (!value) {
			return undefined;
		}
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return undefined;
		}
		return Math.min(parsed, MAX_EVENTS_LIMIT);
	} catch {
		return undefined;
	}
}

function parseFilterFromQuery({
	query,
	fallbackAfter,
}: {
	query: Record<string, string>;
	fallbackAfter?: string;
}): EventFilter {
	try {
		const limit = parseLimit({ value: query.limit });
		const category = typeof query.category === "string" ? query.category : undefined;
		const source = typeof query.source === "string" ? query.source : undefined;
		const afterRaw =
			typeof query.after === "string" && query.after.trim()
				? query.after.trim()
				: undefined;

		return {
			limit,
			category,
			source,
			after: afterRaw ?? fallbackAfter,
		};
	} catch {
		return {};
	}
}

function isEventsStreamPath({ req }: { req: IncomingMessage }): boolean {
	try {
		if ((req.method || "GET").toUpperCase() !== "GET") {
			return false;
		}
		const parsed = parse(req.url || "/", true);
		return parsed.pathname === "/api/claude/events/stream";
	} catch {
		return false;
	}
}

function writeSseEvent({
	res,
	event,
}: {
	res: ServerResponse;
	event: EditorEvent;
}): void {
	try {
		res.write(`id: ${event.eventId}\n`);
		res.write(`event: ${event.category}\n`);
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		// no-op
	}
}

async function writeInitialEvents({
	res,
	listEvents,
	filter,
	updateLastEventId,
}: {
	res: ServerResponse;
	listEvents: ListEventsFn;
	filter: EventFilter;
	updateLastEventId: (eventId: string) => void;
}): Promise<void> {
	try {
		const initialEvents = await listEvents({
			...filter,
			limit: filter.limit ?? DEFAULT_EVENTS_LIMIT,
		});
		for (const event of initialEvents) {
			writeSseEvent({ res, event });
			updateLastEventId(event.eventId);
		}
	} catch {
		// no-op
	}
}

function setSseHeaders({ res }: { res: ServerResponse }): void {
	try {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		if (typeof res.flushHeaders === "function") {
			res.flushHeaders();
		}
		res.write("retry: 1000\n");
		res.write(
			`event: ready\ndata: ${JSON.stringify({ ok: true, timestamp: Date.now() })}\n\n`
		);
	} catch {
		// no-op
	}
}

export function registerClaudeEventsRoutes(
	router: Router,
	{ listEvents }: ClaudeEventsRouteOptions
): void {
	try {
		router.get("/api/claude/events", async (req) => {
			const filter = parseFilterFromQuery({ query: req.query });
			return await listEvents({
				...filter,
				limit: filter.limit ?? DEFAULT_EVENTS_LIMIT,
			});
		});
	} catch {
		// no-op
	}
}

export function handleClaudeEventsStreamRequest({
	req,
	res,
	listEvents,
	subscribeToEvents,
	pollIntervalMs = DEFAULT_SSE_POLL_MS,
}: ClaudeEventsStreamOptions): boolean {
	try {
		if (!isEventsStreamPath({ req })) {
			return false;
		}

		const parsed = parse(req.url || "/", true);
		const query: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed.query)) {
			if (typeof value === "string") {
				query[key] = value;
			}
		}

		const headerLastEventId =
			typeof req.headers["last-event-id"] === "string"
				? req.headers["last-event-id"]
				: undefined;
		const baseFilter = parseFilterFromQuery({
			query,
			fallbackAfter: headerLastEventId,
		});
		let closed = false;
		let lastEventId = baseFilter.after;
		let pollTimer: NodeJS.Timeout | null = null;
		let heartbeatTimer: NodeJS.Timeout | null = null;
		let unsubscribe: (() => void) | null = null;
		let pollInFlight = false;

		const cleanup = () => {
			try {
				if (closed) {
					return;
				}
				closed = true;
				if (pollTimer) {
					clearInterval(pollTimer);
					pollTimer = null;
				}
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = null;
				}
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
				if (!res.writableEnded) {
					res.end();
				}
			} catch {
				// no-op
			}
		};

		const updateLastEventId = (eventId: string) => {
			try {
				lastEventId = eventId;
			} catch {
				// no-op
			}
		};

		setSseHeaders({ res });

		void writeInitialEvents({
			res,
			listEvents,
			filter: {
				...baseFilter,
				after: lastEventId,
			},
			updateLastEventId,
		});

		heartbeatTimer = setInterval(() => {
			try {
				if (closed || res.writableEnded) {
					cleanup();
					return;
				}
				res.write(`: ping ${Date.now()}\n\n`);
			} catch {
				cleanup();
			}
		}, SSE_HEARTBEAT_MS);

		if (subscribeToEvents) {
			unsubscribe = subscribeToEvents({
				listener: (event) => {
					try {
						if (closed || res.writableEnded) {
							cleanup();
							return;
						}

						if (baseFilter.category) {
							const prefix = `${baseFilter.category}.`;
							if (
								event.category !== baseFilter.category &&
								!event.category.startsWith(prefix)
							) {
								return;
							}
						}

						if (baseFilter.source && event.source !== baseFilter.source) {
							return;
						}

						writeSseEvent({ res, event });
						updateLastEventId(event.eventId);
					} catch {
						cleanup();
					}
				},
			});
		} else {
			pollTimer = setInterval(() => {
				if (pollInFlight || closed) {
					return;
				}

				pollInFlight = true;
				void (async () => {
					try {
						const events = await listEvents({
							...baseFilter,
							after: lastEventId,
							limit: baseFilter.limit ?? DEFAULT_EVENTS_LIMIT,
						});

						for (const event of events) {
							if (closed || res.writableEnded) {
								cleanup();
								return;
							}
							writeSseEvent({ res, event });
							updateLastEventId(event.eventId);
						}
					} catch {
						cleanup();
					} finally {
						pollInFlight = false;
					}
				})();
			}, Math.max(50, pollIntervalMs));
		}

		req.on("close", cleanup);
		req.on("error", cleanup);
		res.on("close", cleanup);
		res.on("error", cleanup);
		return true;
	} catch {
		try {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Failed to open events stream",
					timestamp: Date.now(),
				})
			);
		} catch {
			// no-op
		}
		return true;
	}
}

