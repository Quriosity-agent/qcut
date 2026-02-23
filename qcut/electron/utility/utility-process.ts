/**
 * Electron Utility Process Entry Point
 *
 * Runs Claude HTTP Server and PTY Session Manager outside the main process
 * to prevent UI freezes from I/O-heavy operations.
 *
 * Communication with main process is via parentPort (MessagePort).
 */

/// <reference types="node" />

import {
	startUtilityHttpServer,
	stopUtilityHttpServer,
} from "./utility-http-server.js";
import { UtilityPtyManager } from "./utility-pty-manager.js";
import type { MainToUtilityMessage } from "./utility-ipc-types.js";

// Simple logger for the utility process (electron-log may not be available here)
const logger = {
	info: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
};

// Utility process has process.parentPort for communicating with main.
// We cast via `unknown` because Electron's utility process augments the
// global `process` with `parentPort`, but the base Node.js types don't
// include it.
const maybeParentPort = (process as unknown as { parentPort?: import("node:worker_threads").MessagePort }).parentPort;

if (!maybeParentPort) {
	logger.error(
		"[UtilityProcess] No parentPort available — must run as utilityProcess"
	);
	process.exit(1);
}

// After the guard above, parentPort is guaranteed to be defined
const parentPort: import("node:worker_threads").MessagePort = maybeParentPort;

const ptyManager = new UtilityPtyManager(parentPort);

// Pending request callbacks for main process responses
const pendingRequests = new Map<
	string,
	{ resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

/**
 * Send a request to the main process and await response.
 * Used for operations that need BrowserWindow access.
 */
export function requestFromMain(channel: string, data: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`Main process request timed out: ${channel}`));
		}, 10_000);

		pendingRequests.set(id, {
			resolve: (value: unknown) => {
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
parentPort.on("message", (e: { data?: MainToUtilityMessage } | MainToUtilityMessage) => {
	const msg: MainToUtilityMessage = (e as { data?: MainToUtilityMessage }).data ?? (e as MainToUtilityMessage);

	switch (msg.type) {
		case "init": {
			// Initialize HTTP server and PTY manager
			const { httpPort, appVersion } = msg.config;
			startUtilityHttpServer({
				port: httpPort,
				appVersion,
				requestFromMain,
			});
			logger.info("[UtilityProcess] Initialized");
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

		case "ping":
			// Health check heartbeat -- respond immediately
			parentPort.postMessage({ type: "pong" });
			break;

		case "shutdown":
			stopUtilityHttpServer();
			ptyManager.killAll();
			parentPort.postMessage({ type: "shutdown-complete" });
			break;
	}
});

logger.info("[UtilityProcess] Started, waiting for init...");
