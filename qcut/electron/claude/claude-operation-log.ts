/**
 * Claude operation log for pipeline reporting.
 * Simple in-memory append-only list (cleared on app restart).
 */

import type { PipelineStep } from "../types/claude-api";

const MAX_LOG_ENTRIES = 500;
const operationLog: PipelineStep[] = [];

function pruneLog(): void {
	try {
		if (operationLog.length <= MAX_LOG_ENTRIES) {
			return;
		}
		const overflow = operationLog.length - MAX_LOG_ENTRIES;
		operationLog.splice(0, overflow);
	} catch {
		// no-op
	}
}

export function logOperation(step: PipelineStep): void {
	try {
		operationLog.push(step);
		pruneLog();
	} catch {
		// no-op
	}
}

export function getOperationLog({
	projectId,
}: {
	projectId?: string;
} = {}): PipelineStep[] {
	try {
		const entries = projectId
			? operationLog.filter((step) => step.projectId === projectId)
			: operationLog;

		return [...entries].sort((a, b) => a.timestamp - b.timestamp);
	} catch {
		return [];
	}
}

export function clearOperationLog({
	projectId,
}: {
	projectId?: string;
} = {}): void {
	try {
		if (!projectId) {
			operationLog.length = 0;
			return;
		}

		for (let index = operationLog.length - 1; index >= 0; index--) {
			if (operationLog[index].projectId === projectId) {
				operationLog.splice(index, 1);
			}
		}
	} catch {
		// no-op
	}
}

module.exports = {
	logOperation,
	getOperationLog,
	clearOperationLog,
};
