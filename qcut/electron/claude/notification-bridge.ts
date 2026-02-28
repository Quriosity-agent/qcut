import { ipcMain } from "electron";
import type { EditorEvent } from "../types/claude-api.js";
import { formatOperationForTerminal } from "./utils/operation-formatter.js";
import { claudeLog } from "./utils/logger.js";

const HANDLER_NAME = "NotificationBridge";
const MAX_NOTIFICATION_HISTORY = 50;

type NotificationBridgeWriter = (args: {
	sessionId: string;
	data: string;
}) => boolean;

export interface NotificationBridgeStatus {
	enabled: boolean;
	sessionId: string | null;
}

function sanitizeLimit({ limit }: { limit?: number }): number {
	try {
		if (typeof limit !== "number" || !Number.isFinite(limit)) {
			return MAX_NOTIFICATION_HISTORY;
		}
		const normalized = Math.trunc(limit);
		if (normalized <= 0) {
			return MAX_NOTIFICATION_HISTORY;
		}
		return Math.min(normalized, MAX_NOTIFICATION_HISTORY);
	} catch {
		return MAX_NOTIFICATION_HISTORY;
	}
}

function safeRemoveHandler({ channel }: { channel: string }): void {
	try {
		const ipcMainWithRemove = ipcMain as unknown as {
			removeHandler?: (channelName: string) => void;
		};
		if (typeof ipcMainWithRemove.removeHandler === "function") {
			ipcMainWithRemove.removeHandler(channel);
		}
	} catch {
		// no-op
	}
}

export class NotificationBridge {
	private enabled = false;
	private targetSessionId: string | null = null;
	private history: string[] = [];
	private writer: NotificationBridgeWriter = () => false;

	enable({ sessionId }: { sessionId: string }): NotificationBridgeStatus {
		try {
			const trimmed = sessionId.trim();
			if (!trimmed) {
				throw new Error("sessionId is required");
			}
			this.enabled = true;
			this.targetSessionId = trimmed;
			return this.getStatus();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to enable bridge";
			throw new Error(message);
		}
	}

	disable(): NotificationBridgeStatus {
		try {
			this.enabled = false;
			this.targetSessionId = null;
			return this.getStatus();
		} catch {
			return { enabled: false, sessionId: null };
		}
	}

	getStatus(): NotificationBridgeStatus {
		try {
			return {
				enabled: this.enabled,
				sessionId: this.targetSessionId,
			};
		} catch {
			return { enabled: false, sessionId: null };
		}
	}

	getHistory({ limit }: { limit?: number } = {}): string[] {
		try {
			const normalizedLimit = sanitizeLimit({ limit });
			if (this.history.length <= normalizedLimit) {
				return [...this.history];
			}
			return this.history.slice(-normalizedLimit);
		} catch {
			return [];
		}
	}

	setWriter({ writer }: { writer: NotificationBridgeWriter }): void {
		try {
			this.writer = writer;
		} catch {
			// no-op
		}
	}

	notify({ event }: { event: EditorEvent }): void {
		try {
			if (!this.enabled || !this.targetSessionId) {
				return;
			}

			const formatted = formatOperationForTerminal({ event });
			if (!formatted) {
				return;
			}

			this.pushHistory({ value: formatted });

			const writeSuccess = this.writer({
				sessionId: this.targetSessionId,
				data: formatted,
			});
			if (!writeSuccess) {
				claudeLog.debug(HANDLER_NAME, "Skipped notification write (no PTY target)");
			}
		} catch (error) {
			claudeLog.warn(HANDLER_NAME, "Failed to forward operation notification:", error);
		}
	}

	resetForTests(): void {
		try {
			this.enabled = false;
			this.targetSessionId = null;
			this.history = [];
			this.writer = () => false;
		} catch {
			// no-op
		}
	}

	private pushHistory({ value }: { value: string }): void {
		try {
			this.history.push(value);
			if (this.history.length <= MAX_NOTIFICATION_HISTORY) {
				return;
			}
			const overflow = this.history.length - MAX_NOTIFICATION_HISTORY;
			this.history.splice(0, overflow);
		} catch {
			// no-op
		}
	}
}

export const notificationBridge = new NotificationBridge();

export function setupClaudeNotificationIPC(): void {
	try {
		safeRemoveHandler({ channel: "claude:notifications:enable" });
		safeRemoveHandler({ channel: "claude:notifications:disable" });
		safeRemoveHandler({ channel: "claude:notifications:status" });
		safeRemoveHandler({ channel: "claude:notifications:history" });

		ipcMain.handle("claude:notifications:enable", async (_event, payload) => {
			try {
				const sessionId =
					typeof payload?.sessionId === "string" ? payload.sessionId : "";
				return notificationBridge.enable({ sessionId });
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Failed to enable notifications";
				throw new Error(message);
			}
		});

		ipcMain.handle("claude:notifications:disable", async () => {
			try {
				return notificationBridge.disable();
			} catch {
				return { enabled: false, sessionId: null };
			}
		});

		ipcMain.handle("claude:notifications:status", async () => {
			try {
				return notificationBridge.getStatus();
			} catch {
				return { enabled: false, sessionId: null };
			}
		});

		ipcMain.handle("claude:notifications:history", async (_event, payload) => {
			try {
				const limit =
					typeof payload?.limit === "number" ? payload.limit : undefined;
				return notificationBridge.getHistory({ limit });
			} catch {
				return [];
			}
		});

		claudeLog.info(HANDLER_NAME, "Claude notification bridge IPC registered");
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to setup notification bridge IPC:", error);
	}
}
