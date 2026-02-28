import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "@composio/ao-core";
import {
	HARNESS_STORE_RELATIVE_PATH,
	HARNESS_STORE_VERSION,
	SESSION_KEY_SEPARATOR,
	type HarnessMode,
	type HarnessResolvedTarget,
	type HarnessRuntimeOptions,
	type HarnessSessionRecord,
	type HarnessStore,
	type HarnessStoreContext,
	type HarnessThreadMode,
} from "./harness-types.js";

function createEmptyStore(): HarnessStore {
	return {
		version: HARNESS_STORE_VERSION,
		defaultSessionKey: null,
		sessions: {},
	};
}

function getStorePath({
	config,
}: {
	config: HarnessStoreContext["config"];
}): string {
	const configPath = config.configPath ?? resolve("qagent.yaml");
	return join(dirname(configPath), HARNESS_STORE_RELATIVE_PATH);
}

function normalizeStore({
	raw,
}: {
	raw: unknown;
}): HarnessStore {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return createEmptyStore();
	}

	const parsed = raw as {
		version?: unknown;
		defaultSessionKey?: unknown;
		sessions?: unknown;
	};
	const sessions: Record<string, HarnessSessionRecord> = {};
	const rawSessions = parsed.sessions;
	if (rawSessions && typeof rawSessions === "object" && !Array.isArray(rawSessions)) {
		for (const [key, value] of Object.entries(rawSessions)) {
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				continue;
			}
			const record = value as Partial<HarnessSessionRecord>;
			if (
				typeof record.key !== "string" ||
				typeof record.sessionId !== "string" ||
				typeof record.agentId !== "string" ||
				typeof record.projectId !== "string" ||
				typeof record.mode !== "string" ||
				typeof record.threadMode !== "string" ||
				typeof record.createdAt !== "string" ||
				typeof record.updatedAt !== "string"
			) {
				continue;
			}

			const runtimeOptions =
				record.runtimeOptions &&
				typeof record.runtimeOptions === "object" &&
				!Array.isArray(record.runtimeOptions)
					? (record.runtimeOptions as HarnessRuntimeOptions)
					: {};
			sessions[key] = {
				key: record.key,
				sessionId: record.sessionId,
				agentId: record.agentId,
				projectId: record.projectId,
				mode: record.mode as HarnessMode,
				threadMode: record.threadMode as HarnessThreadMode,
				label: record.label,
				runtimeOptions,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			};
		}
	}

	return {
		version:
			typeof parsed.version === "number"
				? parsed.version
				: HARNESS_STORE_VERSION,
		defaultSessionKey:
			typeof parsed.defaultSessionKey === "string"
				? parsed.defaultSessionKey
				: null,
		sessions,
	};
}

function loadStore({
	storePath,
}: {
	storePath: string;
}): HarnessStore {
	if (!existsSync(storePath)) {
		return createEmptyStore();
	}
	try {
		const raw = JSON.parse(readFileSync(storePath, "utf-8")) as unknown;
		return normalizeStore({ raw });
	} catch {
		return createEmptyStore();
	}
}

export function saveStore({
	storePath,
	store,
}: {
	storePath: string;
	store: HarnessStore;
}): void {
	const tempPath = `${storePath}.tmp-${Date.now()}`;
	try {
		mkdirSync(dirname(storePath), { recursive: true });
		writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
		renameSync(tempPath, storePath);
	} finally {
		if (!existsSync(tempPath)) {
			return;
		}
		try {
			unlinkSync(tempPath);
		} catch {
			// Best effort temp cleanup.
		}
	}
}

export function getTargetContext(): HarnessStoreContext {
	const config = loadConfig();
	const storePath = getStorePath({ config });
	const store = loadStore({ storePath });
	return { config, storePath, store };
}

export function resolveTarget({
	context,
	target,
}: {
	context: HarnessStoreContext;
	target?: string;
}): HarnessResolvedTarget {
	const { store } = context;
	if (target) {
		const byKey = store.sessions[target];
		if (byKey) {
			return { record: byKey, context };
		}

		for (const record of Object.values(store.sessions)) {
			if (record.sessionId === target) {
				return { record, context };
			}
		}

		for (const record of Object.values(store.sessions)) {
			if (record.label === target) {
				return { record, context };
			}
		}
		throw new Error(`Unable to resolve session target: ${target}`);
	}

	const fallbackKey = store.defaultSessionKey;
	if (fallbackKey && store.sessions[fallbackKey]) {
		return { record: store.sessions[fallbackKey], context };
	}

	throw new Error("No harness session target found");
}

export function makeSessionKey({
	agentId,
	sessionId,
}: {
	agentId: string;
	sessionId: string;
}): string {
	return ["agent", agentId, "harness", sessionId].join(SESSION_KEY_SEPARATOR);
}

export function removeSessionFromStore({
	store,
	key,
}: {
	store: HarnessStore;
	key: string;
}): void {
	delete store.sessions[key];
	if (store.defaultSessionKey !== key) {
		return;
	}
	const remainingKeys = Object.keys(store.sessions).sort();
	store.defaultSessionKey = remainingKeys[0] ?? null;
}

export function updateRecord({
	context,
	record,
}: {
	context: HarnessStoreContext;
	record: HarnessSessionRecord;
}): void {
	context.store.sessions[record.key] = record;
	context.store.defaultSessionKey = record.key;
	saveStore({
		storePath: context.storePath,
		store: context.store,
	});
}
