/**
 * Electron Utility Process Entry Point
 *
 * Runs Claude HTTP Server and PTY Session Manager outside the main process
 * to prevent UI freezes from I/O-heavy operations.
 *
 * Communication with main process is via parentPort (MessagePort).
 */

/// <reference types="node" />

import { startUtilityHttpServer, stopUtilityHttpServer } from "./utility-http-server.js";
import { UtilityPtyManager } from "./utility-pty-manager.js";

// Utility process has process.parentPort for communicating with main
const parentPort = (process as any).parentPort;

if (!parentPort) {
	console.error("[UtilityProcess] No parentPort available — must run as utilityProcess");
	process.exit(1);
}

const ptyManager = new UtilityPtyManager(parentPort);

// Pending request callbacks for main process responses
const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }>();

/**
 * Send a request to the main process and await response.
 * Used for operations that need BrowserWindow access.
 */
export function requestFromMain(channel: string, data: any): Promise<any> {
	return new Promise((resolve, reject) => {
		const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`Main process request timed out: ${channel}`));
		}, 10_000);

		pendingRequests.set(id, {
			resolve: (value: any) => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: (err: Error) => {
				clearTimeout(timer);
				reject(err);
			},
		});

		parentPort.postMessage({ type: "main-request", id, channel, data });
	});
}

// Handle messages from main process
parentPort.on("message", (e: any) => {
	const msg = e.data ?? e;

	switch (msg.type) {
		case "init": {
			// Initialize HTTP server and PTY manager
			const { httpPort, appVersion } = msg.config;
			startUtilityHttpServer({
				port: httpPort,
				appVersion,
				requestFromMain,
			});
			console.log("[UtilityProcess] Initialized");
			parentPort.postMessage({ type: "ready" });
			break;
		}

		case "main-response": {
			// Response to a requestFromMain call
			const pending = pendingRequests.get(msg.id);
			if (pending) {
				pendingRequests.delete(msg.id);
				if (msg.error) {
					pending.reject(new Error(msg.error));
				} else {
					pending.resolve(msg.result);
				}
			}
			break;
		}

		// PTY operations forwarded from main process IPC handlers
		case "pty:spawn":
			ptyManager.spawn(msg);
			break;
		case "pty:write":
			ptyManager.write(msg.sessionId, msg.data);
			break;
		case "pty:resize":
			ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
			break;
		case "pty:kill":
			ptyManager.kill(msg.sessionId);
			break;
		case "pty:kill-all":
			ptyManager.killAll();
			break;

		case "shutdown":
			stopUtilityHttpServer();
			ptyManager.killAll();
			parentPort.postMessage({ type: "shutdown-complete" });
			break;
	}
});

console.log("[UtilityProcess] Started, waiting for init...");
