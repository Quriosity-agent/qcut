import { generateId } from "../utils/helpers.js";
import type {
	CommandLifecycle,
	CommandRecord,
	CommandState,
	CorrelationId,
} from "../../types/claude-api.js";

const MAX_TRACKED_COMMANDS = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

type CommandWaiter = (record: CommandRecord | null) => void;

function isTerminalState({
	state,
}: {
	state: CommandState;
}): boolean {
	try {
		return state === "applied" || state === "failed";
	} catch {
		return false;
	}
}

function cloneValue<T>({ value }: { value: T }): T {
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
}

function cloneRecord({
	record,
}: {
	record: CommandRecord;
}): CommandRecord {
	try {
		return {
			...record,
			params: cloneValue({ value: record.params }),
		};
	} catch {
		return record;
	}
}

function finalizeDuration({
	record,
	finishedAt,
}: {
	record: CommandRecord;
	finishedAt: number;
}): void {
	try {
		record.duration = Math.max(0, finishedAt - record.createdAt);
	} catch {
		// no-op
	}
}

export function generateCorrelationId(): CorrelationId {
	try {
		return generateId("corr") as CorrelationId;
	} catch {
		return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` as CorrelationId;
	}
}

export function toCommandLifecycle({
	record,
}: {
	record: CommandRecord;
}): CommandLifecycle {
	try {
		return {
			state: record.state,
			createdAt: record.createdAt,
			acceptedAt: record.acceptedAt,
			appliedAt: record.appliedAt,
			failedAt: record.failedAt,
			error: record.error,
			duration: record.duration,
		};
	} catch {
		return {
			state: "failed",
			createdAt: Date.now(),
			error: "Failed to read command lifecycle",
		};
	}
}

export class CorrelationTracker {
	private records = new Map<CorrelationId, CommandRecord>();
	private order: CorrelationId[] = [];
	private waiters = new Map<CorrelationId, Set<CommandWaiter>>();

	startCommand({
		command,
		params,
		correlationId,
	}: {
		command: string;
		params?: Record<string, unknown>;
		correlationId?: CorrelationId;
	}): CommandRecord {
		try {
			const id = correlationId ?? generateCorrelationId();
			const now = Date.now();
			const record: CommandRecord = {
				correlationId: id,
				command,
				params: cloneValue({ value: params ?? {} }),
				state: "pending",
				createdAt: now,
			};

			if (this.records.has(id)) {
				this.records.delete(id);
				this.order = this.order.filter((existingId) => existingId !== id);
			}

			this.records.set(id, record);
			this.order.push(id);
			this.prune();
			this.notifyWaiters({ correlationId: id, record });
			return cloneRecord({ record });
		} catch (error) {
			return {
				correlationId:
					(correlationId ?? generateCorrelationId()) as CorrelationId,
				command,
				params: params ?? {},
				state: "failed",
				createdAt: Date.now(),
				failedAt: Date.now(),
				error:
					error instanceof Error
						? error.message
						: "Failed to start correlation command",
				duration: 0,
			};
		}
	}

	acceptCommand({
		correlationId,
	}: {
		correlationId: CorrelationId;
	}): CommandRecord | null {
		try {
			const record = this.records.get(correlationId);
			if (!record) return null;

			record.state = "accepted";
			record.acceptedAt = record.acceptedAt ?? Date.now();
			record.error = undefined;
			this.notifyWaiters({ correlationId, record });
			return cloneRecord({ record });
		} catch {
			return null;
		}
	}

	applyCommand({
		correlationId,
		state = "applied",
	}: {
		correlationId: CorrelationId;
		state?: "applying" | "applied";
	}): CommandRecord | null {
		try {
			const record = this.records.get(correlationId);
			if (!record) return null;

			if (state === "applying") {
				record.state = "applying";
				record.acceptedAt = record.acceptedAt ?? Date.now();
				this.notifyWaiters({ correlationId, record });
				return cloneRecord({ record });
			}

			const now = Date.now();
			record.state = "applied";
			record.acceptedAt = record.acceptedAt ?? now;
			record.appliedAt = now;
			record.error = undefined;
			finalizeDuration({ record, finishedAt: now });
			this.notifyWaiters({ correlationId, record });
			return cloneRecord({ record });
		} catch {
			return null;
		}
	}

	failCommand({
		correlationId,
		error,
	}: {
		correlationId: CorrelationId;
		error?: string;
	}): CommandRecord | null {
		try {
			const record = this.records.get(correlationId);
			if (!record) return null;

			const now = Date.now();
			record.state = "failed";
			record.acceptedAt = record.acceptedAt ?? now;
			record.failedAt = now;
			record.error = error ?? "Unknown error";
			finalizeDuration({ record, finishedAt: now });
			this.notifyWaiters({ correlationId, record });
			return cloneRecord({ record });
		} catch {
			return null;
		}
	}

	getCommand({
		correlationId,
	}: {
		correlationId: CorrelationId;
	}): CommandRecord | null {
		try {
			const record = this.records.get(correlationId);
			if (!record) return null;
			return cloneRecord({ record });
		} catch {
			return null;
		}
	}

	listCommands({
		limit,
	}: {
		limit?: number;
	} = {}): CommandRecord[] {
		try {
			const resolvedLimit =
				typeof limit === "number" && Number.isFinite(limit) && limit > 0
					? Math.floor(limit)
					: this.order.length;
			const recentIds = [...this.order]
				.reverse()
				.slice(0, Math.min(resolvedLimit, MAX_TRACKED_COMMANDS));
			const records: CommandRecord[] = [];

			for (const id of recentIds) {
				const record = this.records.get(id);
				if (record) {
					records.push(cloneRecord({ record }));
				}
			}

			return records;
		} catch {
			return [];
		}
	}

	async waitForCommand({
		correlationId,
		timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
	}: {
		correlationId: CorrelationId;
		timeoutMs?: number;
	}): Promise<CommandRecord | null> {
		try {
			const record = this.records.get(correlationId);
			if (!record) return null;
			if (isTerminalState({ state: record.state })) {
				return cloneRecord({ record });
			}

			const safeTimeout =
				typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_WAIT_TIMEOUT_MS;

			return await new Promise<CommandRecord | null>((resolve) => {
				const waiter: CommandWaiter = (updatedRecord) => {
					try {
						if (!updatedRecord) {
							cleanup();
							resolve(null);
							return;
						}
						if (!isTerminalState({ state: updatedRecord.state })) {
							return;
						}
						cleanup();
						resolve(cloneRecord({ record: updatedRecord }));
					} catch {
						cleanup();
						resolve(null);
					}
				};

				const cleanup = () => {
					try {
						clearTimeout(timeout);
						const existingWaiters = this.waiters.get(correlationId);
						if (!existingWaiters) return;
						existingWaiters.delete(waiter);
						if (existingWaiters.size === 0) {
							this.waiters.delete(correlationId);
						}
					} catch {
						// no-op
					}
				};

				const timeout = setTimeout(() => {
					try {
						cleanup();
						const currentRecord = this.records.get(correlationId);
						resolve(currentRecord ? cloneRecord({ record: currentRecord }) : null);
					} catch {
						resolve(null);
					}
				}, safeTimeout);

				const existingWaiters = this.waiters.get(correlationId);
				if (existingWaiters) {
					existingWaiters.add(waiter);
					return;
				}

				this.waiters.set(correlationId, new Set([waiter]));
			});
		} catch {
			return null;
		}
	}

	private prune(): void {
		try {
			while (this.order.length > MAX_TRACKED_COMMANDS) {
				const oldestId = this.order.shift();
				if (!oldestId) return;
				this.records.delete(oldestId);
				this.notifyWaiters({ correlationId: oldestId, record: null });
			}
		} catch {
			// no-op
		}
	}

	private notifyWaiters({
		correlationId,
		record,
	}: {
		correlationId: CorrelationId;
		record: CommandRecord | null;
	}): void {
		try {
			const waiters = this.waiters.get(correlationId);
			if (!waiters || waiters.size === 0) return;

			for (const waiter of waiters) {
				waiter(record ? cloneRecord({ record }) : null);
			}
		} catch {
			// no-op
		}
	}
}

export const claudeCorrelationTracker = new CorrelationTracker();

module.exports = {
	CorrelationTracker,
	claudeCorrelationTracker,
	generateCorrelationId,
	toCommandLifecycle,
};
