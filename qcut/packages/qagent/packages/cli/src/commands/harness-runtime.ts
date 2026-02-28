import chalk from "chalk";
import type { SessionManager } from "@composio/ao-core";
import { getSessionManager } from "../lib/create-session-manager.js";
import { exec } from "../lib/shell.js";
import {
	type HarnessSessionRecord,
	type HarnessStatusRecord,
	type HarnessStoreContext,
} from "./harness-types.js";
import { resolveTarget } from "./harness-store.js";

async function getLiveStatus({
	record,
	sm,
}: {
	record: HarnessSessionRecord;
	sm: SessionManager;
}): Promise<HarnessStatusRecord> {
	try {
		const session = await sm.get(record.sessionId);
		return {
			...record,
			liveStatus: session?.status ?? "missing",
			activity: session?.activity ?? null,
		};
	} catch {
		return {
			...record,
			liveStatus: "unknown",
			activity: null,
		};
	}
}

function printStatusLine({
	record,
}: {
	record: HarnessStatusRecord;
}): void {
	const details: string[] = [];
	details.push(chalk.green(record.key));
	details.push(chalk.dim(`[${record.liveStatus}]`));
	details.push(chalk.cyan(record.sessionId));
	details.push(chalk.dim(`agent=${record.agentId}`));
	details.push(chalk.dim(`mode=${record.mode}`));
	if (record.runtimeOptions.model) {
		details.push(chalk.dim(`model=${record.runtimeOptions.model}`));
	}
	if (record.runtimeOptions.permissions) {
		details.push(chalk.dim(`permissions=${record.runtimeOptions.permissions}`));
	}
	if (record.runtimeOptions.timeout !== undefined) {
		details.push(chalk.dim(`timeout=${record.runtimeOptions.timeout}`));
	}
	if (record.runtimeOptions.cwd) {
		details.push(chalk.dim(`cwd=${record.runtimeOptions.cwd}`));
	}
	if (record.label) {
		details.push(chalk.yellow(`label=${record.label}`));
	}
	console.log(details.join("  "));
}

export async function getSessionManagerForContext({
	context,
}: {
	context: HarnessStoreContext;
}): Promise<SessionManager> {
	return getSessionManager(context.config);
}

export async function showStatus({
	context,
	target,
	json,
}: {
	context: HarnessStoreContext;
	target?: string;
	json?: boolean;
}): Promise<void> {
	const sm = await getSessionManagerForContext({ context });
	let records: HarnessSessionRecord[] = [];
	if (target) {
		records = [resolveTarget({ context, target }).record];
	} else {
		records = Object.values(context.store.sessions).sort((a, b) =>
			a.createdAt.localeCompare(b.createdAt)
		);
	}

	const live = await Promise.all(
		records.map((record) => getLiveStatus({ record, sm }))
	);
	if (json) {
		console.log(JSON.stringify(live, null, 2));
		return;
	}
	if (live.length === 0) {
		console.log(chalk.dim("No harness sessions."));
		return;
	}
	for (const record of live) {
		printStatusLine({ record });
	}
}

export async function sendSteer({
	record,
	context,
	message,
}: {
	record: HarnessSessionRecord;
	context: HarnessStoreContext;
	message: string;
}): Promise<void> {
	const sm = await getSessionManagerForContext({ context });
	await sm.send(record.sessionId, message);
}

export async function runCancel({
	record,
	context,
}: {
	record: HarnessSessionRecord;
	context: HarnessStoreContext;
}): Promise<void> {
	const sm = await getSessionManagerForContext({ context });
	const session = await sm.get(record.sessionId);
	if (session?.runtimeHandle?.runtimeName === "tmux") {
		await exec("tmux", ["send-keys", "-t", session.runtimeHandle.id, "C-c"], {
			timeout: 10_000,
		});
		return;
	}
	await sm.send(
		record.sessionId,
		"Cancel current turn now and wait for further instructions."
	);
}

export function printInstallInstructions(): void {
	console.log(chalk.bold("Harness session support is built into qagent."));
	console.log(chalk.dim("No extra install step is required."));
	console.log(
		chalk.dim(
			"Use: qagent harness spawn <agent> [task] and qagent harness status"
		)
	);
}
