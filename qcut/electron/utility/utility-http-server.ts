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
import type { Server } from "node:http";
import { createRouter } from "../claude/utils/http-router.js";
import { claudeLog } from "../claude/utils/logger.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "../claude/http/claude-http-shared-routes.js";

let server: Server | null = null;

// Type for the requestFromMain function passed in from the utility process entry
type RequestFromMainFn = (channel: string, data: any) => Promise<any>;

/** Fake BrowserWindow-like object that proxies calls through main process */
function createWindowProxy(requestFromMain: RequestFromMainFn): any {
	return {
		webContents: {
			send(channel: string, ...args: any[]) {
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

	// Auth check
	function checkAuth(req: any): boolean {
		const token = process.env.QCUT_API_TOKEN;
		if (!token) return true;
		return req.headers.authorization === `Bearer ${token}`;
	}

	// CORS
	function setCorsHeaders(res: any): void {
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
