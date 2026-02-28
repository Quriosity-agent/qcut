import type {
	OrchestratorConfig,
	SessionManager,
	TeamManager,
} from "@composio/ao-core";

export const HARNESS_STORE_VERSION = 1;
export const HARNESS_STORE_RELATIVE_PATH = ".qagent/harness-sessions.json";
export const SESSION_KEY_SEPARATOR = ":";
export const VALID_MODE = {
	PERSISTENT: "persistent",
	ONESHOT: "oneshot",
} as const;
export const VALID_THREAD_MODE = {
	AUTO: "auto",
	HERE: "here",
	OFF: "off",
} as const;
export const RELAY_OUTPUT_MODE = {
	PROTOCOL: "protocol",
	RAW: "raw",
} as const;
export const RELAY_PROTOCOL_PREFIX = "[qagent-protocol]";
export const RELAY_DEFAULT_PROTOCOL_TTL = 2;
export const RELAY_DEFAULT_DEDUP_CACHE_SIZE = 1024;

export type HarnessMode = (typeof VALID_MODE)[keyof typeof VALID_MODE];
export type HarnessThreadMode =
	(typeof VALID_THREAD_MODE)[keyof typeof VALID_THREAD_MODE];
export type RelayOutputMode =
	(typeof RELAY_OUTPUT_MODE)[keyof typeof RELAY_OUTPUT_MODE];

export interface HarnessRuntimeOptions {
	model?: string;
	permissions?: string;
	timeout?: number;
	cwd?: string;
	[key: string]: string | number | undefined;
}

export interface HarnessSessionRecord {
	key: string;
	sessionId: string;
	agentId: string;
	projectId: string;
	mode: HarnessMode;
	threadMode: HarnessThreadMode;
	label?: string;
	runtimeOptions: HarnessRuntimeOptions;
	createdAt: string;
	updatedAt: string;
}

export interface HarnessStore {
	version: number;
	defaultSessionKey: string | null;
	sessions: Record<string, HarnessSessionRecord>;
}

export interface HarnessSpawnOptions {
	project?: string;
	mode?: string;
	thread?: string;
	label?: string;
	model?: string;
	permissions?: string;
	timeout?: string;
	cwd?: string;
}

export interface HarnessTargetOptions {
	session?: string;
}

export interface HarnessStatusOptions extends HarnessTargetOptions {
	json?: boolean;
}

export interface HarnessOptionSetOptions extends HarnessTargetOptions {
	apply?: boolean;
}

export interface HarnessRelayOptions extends HarnessTargetOptions {
	team?: string;
	member?: string;
	to?: string;
	root?: string;
	interval?: string;
	batch?: string;
	lines?: string;
	maxChars?: string;
	once?: boolean;
	output?: boolean;
	outputMode?: string;
	protocolTtl?: string;
	dedupCache?: string;
	emitInitialOutput?: boolean;
}

export interface HarnessStoreContext {
	config: OrchestratorConfig;
	storePath: string;
	store: HarnessStore;
}

export interface HarnessResolvedTarget {
	record: HarnessSessionRecord;
	context: HarnessStoreContext;
}

export interface HarnessStatusRecord extends HarnessSessionRecord {
	liveStatus: string;
	activity: string | null;
}

export interface RelayParsedOptions {
	teamId: string;
	member: string;
	rootDir: string;
	intervalMs: number;
	batchSize: number;
	outputLines: number;
	maxChars: number;
	once: boolean;
	outputEnabled: boolean;
	outputMode: RelayOutputMode;
	protocolTTL: number;
	dedupCacheSize: number;
	emitInitialOutput: boolean;
}

export interface RelayRunConfig extends RelayParsedOptions {
	peers: string[];
	record: HarnessSessionRecord;
	teamManager: TeamManager;
	sm: SessionManager;
}

export interface RelayState {
	previousOutput: string | null;
	seenProtocolIds: Set<string>;
	seenProtocolOrder: string[];
}

export interface RelaySignalController {
	isStopped: () => boolean;
	dispose: () => void;
}
