/**
 * Claude HTTP Server for Utility Process
 *
 * This is the HTTP server that runs inside the utility process.
 * Instead of directly accessing BrowserWindow, it uses requestFromMain()
 * to proxy renderer-dependent operations through the main process.
 *
 * Uses shared route definitions from claude-http-shared-routes.ts with
 * a proxied WindowAccessor that forwards calls through the main process.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createRouter, HttpError } from "../claude/utils/http-router.js";
import { claudeLog } from "../claude/utils/logger.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "../claude/http/claude-http-shared-routes.js";

let server: Server | null = null;

// Type for the requestFromMain function passed in from the utility process entry
type RequestFromMainFn = (
	channel: string,
	data: Record<string, unknown>
) => Promise<unknown>;

/** Window proxy shape returned by createWindowProxy */
interface WindowProxy {
	webContents: {
		send(channel: string, ...args: unknown[]): void;
	};
}

/** Fake BrowserWindow-like object that proxies calls through main process */
function createWindowProxy(requestFromMain: RequestFromMainFn): WindowProxy {
	return {
		webContents: {
			send(channel: string, ...args: unknown[]) {
				// Fire-and-forget to main process
				requestFromMain("webcontents-send", { channel, args }).catch(
					(err: Error) => {
						claudeLog.warn(
							"HTTP",
							`Failed to send to renderer: ${err.message}`
						);
					}
				);
			},
		},
	};
}

interface UtilityHttpConfig {
	port: number;
	appVersion: string;
	requestFromMain: RequestFromMainFn;
}

export function startUtilityHttpServer(config: UtilityHttpConfig): void {
	const { port, appVersion, requestFromMain } = config;

	if (server) {
		claudeLog.warn("HTTP", "Server already running in utility process");
		return;
	}

	const router = createRouter();

	// Create WindowAccessor that proxies through main process
	const accessor: WindowAccessor = {
		getWindow: () => createWindowProxy(requestFromMain),
		requestTimeline: () => requestFromMain("get-timeline", {}),
		requestSelection: () => requestFromMain("get-selection", {}),
		requestSplit: (elementId, splitTime, mode) =>
			requestFromMain("split-element", { elementId, splitTime, mode }),
		getProjectStats: (projectId) =>
			requestFromMain("get-project-stats", { projectId }),
		getAppVersion: () => appVersion,
		batchAddElements: (projectId, elements) =>
			requestFromMain("batch-add-elements", { projectId, elements }),
		batchUpdateElements: (updates) =>
			requestFromMain("batch-update-elements", { updates }),
		batchDeleteElements: (elements, ripple) =>
			requestFromMain("batch-delete-elements", { elements, ripple }),
		arrangeTimeline: (data) => requestFromMain("arrange-timeline", data),
	};

	// Register all shared routes
	registerSharedRoutes(router, accessor);

	// ==========================================================================
	// Navigator routes (project listing + editor navigation)
	// ==========================================================================
	router.get("/api/claude/navigator/projects", async () => {
		return await Promise.race([
			requestFromMain("get-projects", {}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Renderer timed out")),
					10_000
				)
			),
		]);
	});

	router.post("/api/claude/navigator/open", async (req) => {
		if (!req.body?.projectId || typeof req.body.projectId !== "string") {
			throw new HttpError(400, "Missing 'projectId' in request body");
		}
		return await Promise.race([
			requestFromMain("navigate-to-project", {
				projectId: req.body.projectId,
			}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Renderer timed out")),
					10_000
				)
			),
		]);
	});

	// ==========================================================================
	// Screen Recording routes
	// ==========================================================================
	router.get("/api/claude/screen-recording/sources", async () => {
		return await Promise.race([
			requestFromMain("screen-recording:sources", {}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Timed out listing sources")),
					10_000
				)
			),
		]);
	});

	router.get("/api/claude/screen-recording/status", async () => {
		return await Promise.race([
			requestFromMain("screen-recording:status", {}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Timed out getting status")),
					10_000
				)
			),
		]);
	});

	router.post("/api/claude/screen-recording/start", async (req) => {
		const sourceId = req.body?.sourceId as string | undefined;
		const fileName = req.body?.fileName as string | undefined;
		return await Promise.race([
			requestFromMain("screen-recording:start", { sourceId, fileName }),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Recording start timed out")),
					30_000
				)
			),
		]);
	});

	router.post("/api/claude/screen-recording/stop", async (req) => {
		const discard = req.body?.discard as boolean | undefined;
		return await Promise.race([
			requestFromMain("screen-recording:stop", { discard }),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Recording stop timed out")),
					60_000
				)
			),
		]);
	});

	// ==========================================================================
	// UI Panel Navigation routes
	// ==========================================================================
	router.post("/api/claude/ui/switch-panel", async (req) => {
		if (!req.body?.panel || typeof req.body.panel !== "string") {
			throw new HttpError(400, "Missing 'panel' in request body");
		}
		return await Promise.race([
			requestFromMain("switch-panel", { panel: req.body.panel }),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Panel switch timed out")),
					10_000
				)
			),
		]);
	});

	// Auth check
	function checkAuth(req: IncomingMessage): boolean {
		const token = process.env.QCUT_API_TOKEN;
		if (!token) return true;
		return req.headers.authorization === `Bearer ${token}`;
	}

	// CORS
	function setCorsHeaders(res: ServerResponse): void {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader(
			"Access-Control-Allow-Methods",
			"GET, POST, PATCH, DELETE, OPTIONS"
		);
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization"
		);
	}

	// ==========================================================================
	// Create and start server
	// ==========================================================================
	server = createServer((req, res) => {
		setCorsHeaders(res);
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		req.setTimeout(30_000, () => {
			res.writeHead(408, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Request timeout",
					timestamp: Date.now(),
				})
			);
		});
		if (!checkAuth(req)) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Unauthorized",
					timestamp: Date.now(),
				})
			);
			return;
		}
		router.handle(req, res);
	});

	server.listen(port, "127.0.0.1", () => {
		claudeLog.info(
			"HTTP",
			`Server started on http://127.0.0.1:${port} (utility process)`
		);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			claudeLog.warn("HTTP", `Port ${port} in use. Claude HTTP API disabled.`);
		} else {
			claudeLog.error("HTTP", `Server error: ${err.message}`);
		}
		server = null;
	});
}

export function stopUtilityHttpServer(): void {
	if (server) {
		server.close();
		server = null;
		claudeLog.info("HTTP", "Server stopped (utility process)");
	}
}
