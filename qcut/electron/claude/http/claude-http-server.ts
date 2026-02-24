/**
 * Claude HTTP Server
 * Exposes QCut's Claude API over HTTP so Claude Code can control QCut externally.
 *
 * Architecture:
 *   Claude Code --> HTTP --> localhost:8765 --> extracted handler functions --> QCut
 *
 * Uses shared route definitions from claude-http-shared-routes.ts with direct
 * BrowserWindow access (main process).
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { app, BrowserWindow } from "electron";
import { createRouter, HttpError } from "../utils/http-router.js";
import { claudeLog } from "../utils/logger.js";
import {
	requestTimelineFromRenderer,
	requestSplitFromRenderer,
	requestSelectionFromRenderer,
	batchAddElements,
	batchUpdateElements,
	batchDeleteElements,
	arrangeTimeline,
} from "../handlers/claude-timeline-handler.js";
import { getProjectStats } from "../handlers/claude-project-handler.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "./claude-http-shared-routes.js";
import {
	requestProjectsFromRenderer,
	requestNavigateToProject,
} from "../handlers/claude-navigator-handler.js";

let server: Server | null = null;

/**
 * Get the first available BrowserWindow or throw 503
 */
function getWindow(): BrowserWindow {
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) throw new HttpError(503, "No active QCut window");
	return win;
}

/**
 * Check bearer token auth (only enforced when QCUT_API_TOKEN is set)
 */
function checkAuth(req: IncomingMessage): boolean {
	const token = process.env.QCUT_API_TOKEN;
	if (!token) return true;
	const authHeader = req.headers.authorization;
	return authHeader === `Bearer ${token}`;
}

/** Set permissive CORS headers on the HTTP response. */
function setCorsHeaders(res: ServerResponse): void {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader(
		"Access-Control-Allow-Methods",
		"GET, POST, PATCH, DELETE, OPTIONS"
	);
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Start the local HTTP API server for Claude and MCP integrations. */
export function startClaudeHTTPServer(
	port = Number.parseInt(process.env.QCUT_API_PORT ?? "8765", 10)
): void {
	const resolvedPort = Number.isFinite(port) && port > 0 ? port : 8765;
	if (resolvedPort !== port) {
		claudeLog.warn("HTTP", "Invalid QCUT_API_PORT, falling back to 8765");
	}
	if (server) {
		claudeLog.warn("HTTP", "Server already running, skipping start");
		return;
	}

	const router = createRouter();

	// Create WindowAccessor for direct main-process BrowserWindow access
	const accessor: WindowAccessor = {
		getWindow,
		requestTimeline: () => requestTimelineFromRenderer(getWindow()),
		requestSelection: () => requestSelectionFromRenderer(getWindow()),
		requestSplit: (elementId, splitTime, mode) =>
			requestSplitFromRenderer(getWindow(), elementId, splitTime, mode),
		getProjectStats: (projectId) => getProjectStats(getWindow(), projectId),
		getAppVersion: () => app.getVersion(),
		batchAddElements: (projectId, elements) =>
			batchAddElements(getWindow(), projectId, elements),
		batchUpdateElements: (updates) => batchUpdateElements(getWindow(), updates),
		batchDeleteElements: (elements, ripple) =>
			batchDeleteElements(getWindow(), elements, ripple),
		arrangeTimeline: (data) => arrangeTimeline(getWindow(), data),
	};

	// Register all shared routes
	registerSharedRoutes(router, accessor);

	// ==========================================================================
	// Navigator routes (project listing + editor navigation)
	// ==========================================================================
	router.get("/api/claude/navigator/projects", async () => {
		const win = getWindow();
		return await Promise.race([
			requestProjectsFromRenderer(win),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
	});

	router.post("/api/claude/navigator/open", async (req) => {
		if (!req.body?.projectId || typeof req.body.projectId !== "string") {
			throw new HttpError(400, "Missing 'projectId' in request body");
		}
		const win = getWindow();
		return await Promise.race([
			requestNavigateToProject(win, req.body.projectId),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
	});

	// ==========================================================================
	// Create and start the server
	// ==========================================================================
	server = createServer((req, res) => {
		setCorsHeaders(res);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		// 30s request timeout
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

		// Auth check
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

	server.listen(resolvedPort, "127.0.0.1", () => {
		claudeLog.info(
			"HTTP",
			`Server started on http://127.0.0.1:${resolvedPort}`
		);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			claudeLog.warn(
				"HTTP",
				`Port ${resolvedPort} in use. Claude HTTP API disabled.`
			);
		} else {
			claudeLog.error("HTTP", `Server error: ${err.message}`);
		}
		server = null;
	});
}

/** Stop the running Claude HTTP server if active. */
export function stopClaudeHTTPServer(): void {
	if (server) {
		server.close();
		server = null;
		claudeLog.info("HTTP", "Server stopped");
	}
}

// CommonJS export for main.ts compatibility
module.exports = { startClaudeHTTPServer, stopClaudeHTTPServer };
