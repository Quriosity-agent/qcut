/**
 * Utility Process Bridge
 *
 * Launches and manages the utility process from the main process.
 * Handles:
 * - Starting/stopping the utility process
 * - Proxying BrowserWindow operations from utility → main
 * - Forwarding PTY IPC from renderer → utility and back
 * - Crash recovery
 */

import { utilityProcess, BrowserWindow, ipcMain, app, webContents } from "electron";
import * as path from "node:path";
import {
	requestTimelineFromRenderer,
	requestSplitFromRenderer,
	requestSelectionFromRenderer,
	batchAddElements,
	batchUpdateElements,
	batchDeleteElements,
	arrangeTimeline,
} from "../claude/handlers/claude-timeline-handler.js";
import { getProjectStats } from "../claude/handlers/claude-project-handler.js";
import * as fs from "node:fs";

let utilityChild: ReturnType<typeof utilityProcess.fork> | null = null;

// Track PTY session → webContents mapping for forwarding data back
const sessionToWebContentsId = new Map<string, number>();
// Track pending PTY spawn requests
const pendingPtySpawns = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }>();

/** Get the first active BrowserWindow */
function getWindow(): BrowserWindow | null {
	return BrowserWindow.getAllWindows()[0] ?? null;
}

/** Resolve QCut MCP server entry point (mirrors pty-handler logic). */
function resolveQcutMcpServerEntry(): string | null {
	const candidates = [
		path.resolve(__dirname, "mcp", "qcut-mcp-server.js"),
		path.resolve(app.getAppPath(), "dist", "electron", "mcp", "qcut-mcp-server.js"),
		path.resolve(app.getAppPath(), "electron", "mcp", "qcut-mcp-server.js"),
	];
	for (const c of candidates) {
		try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
	}
	return null;
}

/**
 * Handle a request from the utility process that needs main-process APIs.
 */
async function handleMainRequest(channel: string, data: any): Promise<any> {
	const win = getWindow();
	if (!win) throw new Error("No active window");

	switch (channel) {
		case "webcontents-send": {
			win.webContents.send(data.channel, ...data.args);
			return { sent: true };
		}

		case "get-timeline": {
			return requestTimelineFromRenderer(win);
		}

		case "get-selection": {
			return requestSelectionFromRenderer(win);
		}

		case "split-element": {
			return requestSplitFromRenderer(win, data.elementId, data.splitTime, data.mode);
		}

		case "get-project-stats": {
			return getProjectStats(win, data.projectId);
		}

		case "batch-add-elements": {
			return batchAddElements(win, data.projectId, data.elements);
		}

		case "batch-update-elements": {
			return batchUpdateElements(win, data.updates);
		}

		case "batch-delete-elements": {
			return batchDeleteElements(win, data.elements, data.ripple);
		}

		case "arrange-timeline": {
			return arrangeTimeline(win, data);
		}

		default:
			throw new Error(`Unknown main-request channel: ${channel}`);
	}
}

/** Start the utility process */
export function startUtilityProcess(): void {
	if (utilityChild) {
		console.warn("[UtilityBridge] Utility process already running");
		return;
	}

	const utilityPath = path.join(__dirname, "utility", "utility-process.js");
	console.log(`[UtilityBridge] Forking utility process: ${utilityPath}`);

	utilityChild = utilityProcess.fork(utilityPath);

	// Handle messages from utility process
	utilityChild.on("message", async (msg: any) => {
		switch (msg.type) {
			case "ready":
				console.log("[UtilityBridge] Utility process ready");
				break;

			case "main-request": {
				// Utility process needs something from main
				try {
					const result = await handleMainRequest(msg.channel, msg.data);
					utilityChild?.postMessage({ type: "main-response", id: msg.id, result });
				} catch (err: any) {
					utilityChild?.postMessage({ type: "main-response", id: msg.id, error: err.message });
				}
				break;
			}

			// PTY data/exit forwarded to the correct renderer
			case "pty:data":
			case "pty:exit": {
				const webContentsId = sessionToWebContentsId.get(msg.sessionId);
				if (webContentsId != null) {
					try {
						const contents = webContents.fromId(webContentsId);
						if (contents && !contents.isDestroyed()) {
							contents.send(msg.type, msg);
						}
					} catch { /* renderer gone */ }
				}
				if (msg.type === "pty:exit") {
					sessionToWebContentsId.delete(msg.sessionId);
				}
				break;
			}

			case "pty:spawn-result": {
				const pending = pendingPtySpawns.get(msg.requestId);
				if (pending) {
					pendingPtySpawns.delete(msg.requestId);
					if (msg.success) {
						pending.resolve({ success: true, sessionId: msg.sessionId });
					} else {
						pending.resolve({ success: false, error: msg.error });
					}
				}
				break;
			}

			case "pty:kill-result":
			case "pty:kill-all-result":
				// Fire-and-forget acknowledgments
				break;
		}
	});

	// Crash recovery
	utilityChild.on("exit", (code) => {
		console.error(`[UtilityBridge] Utility process exited with code ${code}`);
		utilityChild = null;

		// Notify all renderers that PTY sessions are gone
		for (const [sessionId, webContentsId] of sessionToWebContentsId) {
			try {
				const contents = webContents.fromId(webContentsId);
				if (contents && !contents.isDestroyed()) {
					contents.send("pty:exit", { sessionId, exitCode: -1, signal: "CRASHED" });
				}
			} catch { /* ignore */ }
		}
		sessionToWebContentsId.clear();

		// Resolve any pending spawns with failure
		for (const [, pending] of pendingPtySpawns) {
			pending.resolve({ success: false, error: "Utility process crashed" });
		}
		pendingPtySpawns.clear();

		// Auto-restart after crash (not on clean exit)
		if (code !== 0 && code !== null) {
			console.log("[UtilityBridge] Restarting utility process in 1s...");
			setTimeout(() => startUtilityProcess(), 1000);
		}
	});

	// Send init config
	const httpPort = Number.parseInt(process.env.QCUT_API_PORT ?? "8765", 10);
	utilityChild.postMessage({
		type: "init",
		config: {
			httpPort: Number.isFinite(httpPort) && httpPort > 0 ? httpPort : 8765,
			appVersion: app.getVersion(),
		},
	});
}

/** Stop the utility process */
export function stopUtilityProcess(): void {
	if (utilityChild) {
		utilityChild.postMessage({ type: "shutdown" });
		// Give it a moment to clean up, then kill if needed
		setTimeout(() => {
			if (utilityChild) {
				utilityChild.kill();
				utilityChild = null;
			}
		}, 2000);
	}
}

/** Setup PTY IPC handlers that proxy to utility process */
export function setupUtilityPtyIPC(): void {
	console.log("[UtilityBridge] Setting up PTY IPC handlers (proxy mode)...");

	// Clean up PTY sessions when renderer is destroyed
	app.on("web-contents-created", (_, contents) => {
		contents.on("destroyed", () => {
			const contentsId = contents.id;
			const sessionsToKill: string[] = [];
			for (const [sessionId, wcId] of sessionToWebContentsId) {
				if (wcId === contentsId) sessionsToKill.push(sessionId);
			}
			for (const sessionId of sessionsToKill) {
				sessionToWebContentsId.delete(sessionId);
				utilityChild?.postMessage({ type: "pty:kill", sessionId });
			}
		});
	});

	ipcMain.handle("pty:spawn", async (event, options: any = {}): Promise<any> => {
		if (!utilityChild) return { success: false, error: "Utility process not running" };

		const sessionId = `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
		const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

		sessionToWebContentsId.set(sessionId, event.sender.id);

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pendingPtySpawns.delete(requestId);
				resolve({ success: false, error: "PTY spawn timed out" });
			}, 10_000);

			pendingPtySpawns.set(requestId, {
				resolve: (value: any) => { clearTimeout(timer); resolve(value); },
				reject: () => { clearTimeout(timer); resolve({ success: false, error: "PTY spawn failed" }); },
			});

			// Resolve MCP server path in main process (needs app.getAppPath())
			const mcpServerPath = resolveQcutMcpServerEntry();

			utilityChild!.postMessage({
				type: "pty:spawn",
				requestId,
				sessionId,
				command: options.command,
				cols: options.cols,
				rows: options.rows,
				cwd: options.cwd,
				env: options.env,
				mcpServerPath,
				projectId: options.env?.QCUT_PROJECT_ID,
				projectRoot: options.env?.QCUT_PROJECT_ROOT || options.cwd,
				apiBaseUrl: options.env?.QCUT_API_BASE_URL,
			});
		});
	});

	ipcMain.handle("pty:write", async (_, sessionId: string, data: string) => {
		if (!utilityChild) return { success: false, error: "Utility process not running" };
		utilityChild.postMessage({ type: "pty:write", sessionId, data });
		return { success: true };
	});

	ipcMain.handle("pty:resize", async (_, sessionId: string, cols: number, rows: number) => {
		if (!utilityChild) return { success: false, error: "Utility process not running" };
		utilityChild.postMessage({ type: "pty:resize", sessionId, cols, rows });
		return { success: true };
	});

	ipcMain.handle("pty:kill", async (_, sessionId: string) => {
		if (!utilityChild) return { success: false, error: "Utility process not running" };
		utilityChild.postMessage({ type: "pty:kill", sessionId });
		sessionToWebContentsId.delete(sessionId);
		return { success: true };
	});

	ipcMain.handle("pty:kill-all", async () => {
		if (!utilityChild) return { success: true };
		utilityChild.postMessage({ type: "pty:kill-all" });
		sessionToWebContentsId.clear();
		return { success: true };
	});

	console.log("[UtilityBridge] PTY IPC handlers registered (proxy mode)");
}

/** Clean up everything on app quit */
export function cleanupUtilityProcess(): void {
	if (utilityChild) {
		utilityChild.postMessage({ type: "pty:kill-all" });
		utilityChild.kill();
		utilityChild = null;
	}
	sessionToWebContentsId.clear();
	pendingPtySpawns.clear();
}
