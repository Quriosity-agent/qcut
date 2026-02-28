import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import type {
	OrchestratorConfig,
	SessionManager,
	TeamManager,
	TeamMessage,
} from "@composio/ao-core";
import {
	createTeamManager,
	loadConfig,
	parseTeamProtocolMessage,
} from "@composio/ao-core";
import { getSessionManager } from "../lib/create-session-manager.js";
import { exec } from "../lib/shell.js";

const HARNESS_STORE_VERSION = 1;
const HARNESS_STORE_RELATIVE_PATH = ".qagent/harness-sessions.json";
const SESSION_KEY_SEPARATOR = ":";
const VALID_MODE = {
	PERSISTENT: "persistent",
	ONESHOT: "oneshot",
} as const;
const VALID_THREAD_MODE = {
	AUTO: "auto",
	HERE: "here",
	OFF: "off",
} as const;

type HarnessMode = (typeof VALID_MODE)[keyof typeof VALID_MODE];
type HarnessThreadMode =
	(typeof VALID_THREAD_MODE)[keyof typeof VALID_THREAD_MODE];

interface HarnessRuntimeOptions {
	model?: string;
	permissions?: string;
	timeout?: number;
	cwd?: string;
	[key: string]: string | number | undefined;
}

interface HarnessSessionRecord {
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

interface HarnessStore {
	version: number;
	defaultSessionKey: string | null;
	sessions: Record<string, HarnessSessionRecord>;
}

interface HarnessSpawnOptions {
	project?: string;
	mode?: string;
	thread?: string;
	label?: string;
	model?: string;
	permissions?: string;
	timeout?: string;
	cwd?: string;
}

interface HarnessTargetOptions {
	session?: string;
}

interface HarnessStatusOptions extends HarnessTargetOptions {
	json?: boolean;
}

interface HarnessOptionSetOptions extends HarnessTargetOptions {
	apply?: boolean;
}

interface HarnessRelayOptions extends HarnessTargetOptions {
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
	emitInitialOutput?: boolean;
}

interface HarnessStoreContext {
	config: OrchestratorConfig;
	storePath: string;
	store: HarnessStore;
}

interface HarnessResolvedTarget {
	record: HarnessSessionRecord;
	context: HarnessStoreContext;
}

interface HarnessStatusRecord extends HarnessSessionRecord {
	liveStatus: string;
	activity: string | null;
}

interface RelayParsedOptions {
	teamId: string;
	member: string;
	rootDir: string;
	intervalMs: number;
	batchSize: number;
	outputLines: number;
	maxChars: number;
	once: boolean;
	outputEnabled: boolean;
	emitInitialOutput: boolean;
}

interface RelayRunConfig extends RelayParsedOptions {
	peers: string[];
	record: HarnessSessionRecord;
	teamManager: TeamManager;
	sm: SessionManager;
}

interface RelayState {
	previousOutput: string | null;
}

interface RelaySignalController {
	isStopped: () => boolean;
	dispose: () => void;
}

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
	config: OrchestratorConfig;
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

function saveStore({
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
		if (existsSync(tempPath)) {
			try {
				unlinkSync(tempPath);
			} catch {
				// Best effort temp cleanup.
			}
		}
	}
}

function parseMode({
	mode,
}: {
	mode?: string;
}): HarnessMode {
	if (!mode || mode === VALID_MODE.PERSISTENT) {
		return VALID_MODE.PERSISTENT;
	}
	if (mode === VALID_MODE.ONESHOT) {
		return VALID_MODE.ONESHOT;
	}
	throw new Error(`Invalid mode '${mode}'. Use persistent or oneshot.`);
}

function parseThreadMode({
	thread,
}: {
	thread?: string;
}): HarnessThreadMode {
	if (!thread || thread === VALID_THREAD_MODE.OFF) {
		return VALID_THREAD_MODE.OFF;
	}
	if (thread === VALID_THREAD_MODE.AUTO) {
		return VALID_THREAD_MODE.AUTO;
	}
	if (thread === VALID_THREAD_MODE.HERE) {
		return VALID_THREAD_MODE.HERE;
	}
	throw new Error(`Invalid thread mode '${thread}'. Use auto, here, or off.`);
}

function parseTimeout({
	timeout,
}: {
	timeout?: string;
}): number | undefined {
	if (!timeout) {
		return undefined;
	}
	const parsed = Number.parseInt(timeout, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new Error("timeout must be a positive integer");
	}
	return parsed;
}

function parsePositiveIntegerOption({
	value,
	flag,
}: {
	value: string | undefined;
	flag: string;
}): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
}

function parseKeyValue({
	key,
	value,
}: {
	key: string;
	value: string;
}): string | number {
	if (key === "timeout") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new Error("timeout must be a positive integer");
		}
		return parsed;
	}
	return value;
}

function chooseProject({
	config,
	projectId,
}: {
	config: OrchestratorConfig;
	projectId?: string;
}): string {
	if (projectId) {
		if (!config.projects[projectId]) {
			throw new Error(`Unknown project '${projectId}'`);
		}
		return projectId;
	}
	const projectIds = Object.keys(config.projects);
	if (projectIds.length === 1) {
		return projectIds[0];
	}
	if (projectIds.length === 0) {
		throw new Error("No projects found in config");
	}
	throw new Error(
		"Multiple projects found. Use --project <id> to choose one."
	);
}

function getTargetContext(): HarnessStoreContext {
	const config = loadConfig();
	const storePath = getStorePath({ config });
	const store = loadStore({ storePath });
	return { config, storePath, store };
}

function resolveTarget({
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

function makeSessionKey({
	agentId,
	sessionId,
}: {
	agentId: string;
	sessionId: string;
}): string {
	return ["agent", agentId, "harness", sessionId].join(
		SESSION_KEY_SEPARATOR
	);
}

function removeSessionFromStore({
	store,
	key,
}: {
	store: HarnessStore;
	key: string;
}): void {
	delete store.sessions[key];
	if (store.defaultSessionKey === key) {
		const remainingKeys = Object.keys(store.sessions).sort();
		store.defaultSessionKey = remainingKeys[0] ?? null;
	}
}

function buildPrompt({
	taskText,
	mode,
	runtimeOptions,
}: {
	taskText: string;
	mode: HarnessMode;
	runtimeOptions: HarnessRuntimeOptions;
}): string | undefined {
	const blocks: string[] = [];
	if (taskText) {
		blocks.push(taskText);
	}

	const runtimeHints: string[] = [];
	if (mode === VALID_MODE.ONESHOT) {
		runtimeHints.push("Run this as a one-shot task and stop when done.");
	}
	if (runtimeOptions.cwd) {
		runtimeHints.push(`Requested working directory: ${runtimeOptions.cwd}`);
	}
	if (runtimeOptions.model) {
		runtimeHints.push(`Preferred model: ${runtimeOptions.model}`);
	}
	if (runtimeOptions.permissions) {
		runtimeHints.push(
			`Preferred permissions profile: ${runtimeOptions.permissions}`
		);
	}
	if (runtimeOptions.timeout !== undefined) {
		runtimeHints.push(`Requested timeout: ${runtimeOptions.timeout} seconds`);
	}
	if (runtimeHints.length > 0) {
		blocks.push(runtimeHints.join("\n"));
	}

	if (blocks.length === 0) {
		return undefined;
	}
	return blocks.join("\n\n");
}

function applySpawnOverrides({
	config,
	projectId,
	agentId,
	runtimeOptions,
}: {
	config: OrchestratorConfig;
	projectId: string;
	agentId: string;
	runtimeOptions: HarnessRuntimeOptions;
}): OrchestratorConfig {
	const project = config.projects[projectId];
	if (!project) {
		throw new Error(`Unknown project '${projectId}'`);
	}
	const nextAgentConfig = {
		...(project.agentConfig ?? {}),
	};
	if (
		runtimeOptions.permissions === "skip" ||
		runtimeOptions.permissions === "default"
	) {
		nextAgentConfig.permissions = runtimeOptions.permissions;
	}
	if (typeof runtimeOptions.model === "string") {
		nextAgentConfig.model = runtimeOptions.model;
	}

	return {
		...config,
		projects: {
			...config.projects,
			[projectId]: {
				...project,
				agent: agentId,
				agentConfig: nextAgentConfig,
			},
		},
	};
}

async function getSessionManagerForContext({
	context,
}: {
	context: HarnessStoreContext;
}): Promise<SessionManager> {
	return getSessionManager(context.config);
}

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

async function showStatus({
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

async function sendSteer({
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

function updateRecord({
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

function ensureAbsolutePath({
	cwd,
}: {
	cwd: string;
}): void {
	if (!isAbsolute(cwd)) {
		throw new Error("cwd must be an absolute path");
	}
}

function parsePermissionValue({
	value,
}: {
	value: string;
}): string {
	if (!value.trim()) {
		throw new Error("permissions value cannot be empty");
	}
	return value.trim();
}

function parseInstruction({
	parts,
}: {
	parts: string[];
}): string {
	const message = parts.join(" ").trim();
	if (!message) {
		throw new Error("instruction message is required");
	}
	return message;
}

function parseTaskText({
	parts,
}: {
	parts: string[];
}): string {
	return parts.join(" ").trim();
}

function resolveTeamRoot({
	root,
}: {
	root?: string;
}): string {
	return root ?? process.env.QAGENT_TEAM_ROOT ?? "~/.claude/teams";
}

function parseRelayOptions({
	options,
}: {
	options: HarnessRelayOptions;
}): RelayParsedOptions {
	if (!options.team || !options.team.trim()) {
		throw new Error("--team is required");
	}
	if (!options.member || !options.member.trim()) {
		throw new Error("--member is required");
	}

	return {
		teamId: options.team.trim(),
		member: options.member.trim(),
		rootDir: resolveTeamRoot({ root: options.root }),
		intervalMs:
			parsePositiveIntegerOption({
				value: options.interval,
				flag: "--interval",
			}) ?? 1_500,
		batchSize:
			parsePositiveIntegerOption({
				value: options.batch,
				flag: "--batch",
			}) ?? 20,
		outputLines:
			parsePositiveIntegerOption({
				value: options.lines,
				flag: "--lines",
			}) ?? 120,
		maxChars:
			parsePositiveIntegerOption({
				value: options.maxChars,
				flag: "--max-chars",
			}) ?? 4_000,
		once: Boolean(options.once),
		outputEnabled: options.output !== false,
		emitInitialOutput: Boolean(options.emitInitialOutput),
	};
}

async function resolveRelayPeers({
	teamManager,
	teamId,
	member,
	to,
}: {
	teamManager: TeamManager;
	teamId: string;
	member: string;
	to?: string;
}): Promise<string[]> {
	try {
		const members = await teamManager.listMembers({ teamId });
		if (members.length === 0) {
			throw new Error(`Team '${teamId}' has no members`);
		}
		if (!members.includes(member)) {
			throw new Error(`Member '${member}' not found in team '${teamId}'`);
		}

		let peers: string[];
		if (to && to.trim()) {
			const requested = to
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
			const uniqueRequested = [...new Set(requested)];
			for (const peer of uniqueRequested) {
				if (!members.includes(peer)) {
					throw new Error(`Peer '${peer}' not found in team '${teamId}'`);
				}
			}
			peers = uniqueRequested.filter((peer) => peer !== member);
		} else {
			peers = members.filter((candidate) => candidate !== member);
		}

		return peers;
	} catch (error) {
		throw new Error("Failed to resolve relay peers", { cause: error });
	}
}

function createRelaySignalController(): RelaySignalController {
	let stopped = false;
	const onSignal = (): void => {
		stopped = true;
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	return {
		isStopped: () => stopped,
		dispose: () => {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
		},
	};
}

async function sleep({
	ms,
}: {
	ms: number;
}): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function formatInboundRelayMessage({
	message,
}: {
	message: TeamMessage;
}): string {
	const protocol = parseTeamProtocolMessage({ message });
	const headerParts = [
		"[qagent-team-relay]",
		`from=${message.from}`,
		`timestamp=${message.timestamp}`,
	];
	if (message.summary) {
		headerParts.push(`summary=${message.summary}`);
	}

	if (protocol) {
		return `${headerParts.join(" ")}\n${JSON.stringify(protocol, null, 2)}`;
	}

	return `${headerParts.join(" ")}\n${message.text}`;
}

function clipRelayText({
	text,
	maxChars,
}: {
	text: string;
	maxChars: number;
}): string {
	if (text.length <= maxChars) {
		return text;
	}
	const trimmedSize = text.length - maxChars;
	return `[truncated ${trimmedSize} chars]\n${text.slice(-maxChars)}`;
}

function splitLines({
	value,
}: {
	value: string;
}): string[] {
	if (!value) {
		return [];
	}
	return value.split("\n");
}

function findLineOverlap({
	previous,
	current,
}: {
	previous: string[];
	current: string[];
}): number {
	const maxOverlap = Math.min(previous.length, current.length);
	for (let size = maxOverlap; size > 0; size--) {
		let matched = true;
		for (let index = 0; index < size; index++) {
			const previousLine = previous[previous.length - size + index];
			const currentLine = current[index];
			if (previousLine !== currentLine) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return size;
		}
	}
	return 0;
}

function computeOutputDelta({
	previousOutput,
	nextOutput,
	emitInitialOutput,
}: {
	previousOutput: string | null;
	nextOutput: string;
	emitInitialOutput: boolean;
}): string | null {
	if (!nextOutput.trim()) {
		return null;
	}
	if (previousOutput === null) {
		return emitInitialOutput ? nextOutput : null;
	}
	if (previousOutput === nextOutput) {
		return null;
	}

	const previousLines = splitLines({ value: previousOutput });
	const nextLines = splitLines({ value: nextOutput });
	const overlap = findLineOverlap({
		previous: previousLines,
		current: nextLines,
	});
	const deltaLines = nextLines.slice(overlap);
	if (deltaLines.length === 0) {
		return null;
	}
	return deltaLines.join("\n").trim();
}

async function readHarnessOutputSnapshot({
	sm,
	record,
	lines,
}: {
	sm: SessionManager;
	record: HarnessSessionRecord;
	lines: number;
}): Promise<string | null> {
	try {
		const session = await sm.get(record.sessionId);
		if (!session) {
			throw new Error(`Harness session '${record.sessionId}' not found`);
		}
		if (!session.runtimeHandle) {
			return null;
		}
		if (session.runtimeHandle.runtimeName !== "tmux") {
			return null;
		}
		const { stdout } = await exec("tmux", [
			"capture-pane",
			"-t",
			session.runtimeHandle.id,
			"-p",
			"-S",
			`-${lines}`,
		]);
		return stdout.trim();
	} catch (error) {
		throw new Error("Failed to capture harness output", { cause: error });
	}
}

async function relayInboxToHarness({
	teamManager,
	teamId,
	member,
	batchSize,
	record,
	sm,
}: {
	teamManager: TeamManager;
	teamId: string;
	member: string;
	batchSize: number;
	record: HarnessSessionRecord;
	sm: SessionManager;
}): Promise<number> {
	try {
		const inbound = await teamManager.readInbox({
			teamId,
			member,
			unreadOnly: true,
			markAsRead: true,
			limit: batchSize,
		});
		const forwardable = inbound.filter((message) => message.from !== member);
		await Promise.all(
			forwardable.map(async (message) => {
				const envelope = formatInboundRelayMessage({ message });
				await sm.send(record.sessionId, envelope);
			})
		);
		return forwardable.length;
	} catch (error) {
		throw new Error("Failed to relay inbox messages to harness", {
			cause: error,
		});
	}
}

async function relayHarnessToTeam({
	teamManager,
	teamId,
	member,
	peers,
	record,
	state,
	outputLines,
	maxChars,
	emitInitialOutput,
	sm,
}: {
	teamManager: TeamManager;
	teamId: string;
	member: string;
	peers: string[];
	record: HarnessSessionRecord;
	state: RelayState;
	outputLines: number;
	maxChars: number;
	emitInitialOutput: boolean;
	sm: SessionManager;
}): Promise<number> {
	try {
		if (peers.length === 0) {
			return 0;
		}

		const snapshot = await readHarnessOutputSnapshot({
			sm,
			record,
			lines: outputLines,
		});
		if (snapshot === null) {
			return 0;
		}

		const delta = computeOutputDelta({
			previousOutput: state.previousOutput,
			nextOutput: snapshot,
			emitInitialOutput,
		});
		state.previousOutput = snapshot;
		if (!delta) {
			return 0;
		}

		const clipped = clipRelayText({
			text: delta,
			maxChars,
		});
		const relayMessage = [
			`[qagent-harness-relay] session=${record.key}`,
			`timestamp=${new Date().toISOString()}`,
			"",
			clipped,
		].join("\n");

		await Promise.all(
			peers.map(async (peer) => {
				await teamManager.sendMessage({
					teamId,
					from: member,
					to: peer,
					text: relayMessage,
					summary: `relay:${record.agentId}`,
					color: "cyan",
					read: false,
				});
			})
		);
		return peers.length;
	} catch (error) {
		throw new Error("Failed to relay harness output to team", { cause: error });
	}
}

async function runRelayCycle({
	config,
	state,
}: {
	config: RelayRunConfig;
	state: RelayState;
}): Promise<{ inboundCount: number; outboundCount: number }> {
	try {
		const inboundCount = await relayInboxToHarness({
			teamManager: config.teamManager,
			teamId: config.teamId,
			member: config.member,
			batchSize: config.batchSize,
			record: config.record,
			sm: config.sm,
		});

		let outboundCount = 0;
		if (config.outputEnabled) {
			outboundCount = await relayHarnessToTeam({
				teamManager: config.teamManager,
				teamId: config.teamId,
				member: config.member,
				peers: config.peers,
				record: config.record,
				state,
				outputLines: config.outputLines,
				maxChars: config.maxChars,
				emitInitialOutput: config.emitInitialOutput,
				sm: config.sm,
			});
		}

		return { inboundCount, outboundCount };
	} catch (error) {
		throw new Error("Relay cycle failed", { cause: error });
	}
}

async function runCancel({
	record,
	context,
}: {
	record: HarnessSessionRecord;
	context: HarnessStoreContext;
}): Promise<void> {
	const sm = await getSessionManagerForContext({ context });
	const session = await sm.get(record.sessionId);
	if (session?.runtimeHandle?.runtimeName === "tmux") {
		await exec("tmux", ["send-keys", "-t", session.runtimeHandle.id, "C-c"]);
		return;
	}
	await sm.send(
		record.sessionId,
		"Cancel current turn now and wait for further instructions."
	);
}

function printInstallInstructions(): void {
	console.log(chalk.bold("Harness session support is built into qagent."));
	console.log(chalk.dim("No extra install step is required."));
	console.log(
		chalk.dim(
			"Use: qagent harness spawn <agent> [task] and qagent harness status"
		)
	);
}

export function registerHarness(program: Command): void {
	const harness = program
		.command("harness")
		.description("External-harness style control surface for qagent sessions");

	harness
		.command("spawn")
		.description("Spawn a harness session with runtime options")
		.argument("<agent-id>", "Harness target agent (e.g. codex, claude-code)")
		.argument("[task...]", "Initial task prompt")
		.option("-p, --project <id>", "Project ID from config")
		.option("--mode <mode>", "persistent or oneshot", VALID_MODE.PERSISTENT)
		.option("--thread <mode>", "auto, here, or off", VALID_THREAD_MODE.OFF)
		.option("--label <name>", "Operator label")
		.option("--model <id>", "Runtime model override")
		.option("--permissions <profile>", "Runtime permissions profile")
		.option("--timeout <seconds>", "Runtime timeout in seconds")
		.option("--cwd <path>", "Runtime working directory override")
		.action(
			async (
				agentId: string,
				taskParts: string[],
				options: HarnessSpawnOptions
			): Promise<void> => {
				try {
					const context = getTargetContext();
					const projectId = chooseProject({
						config: context.config,
						projectId: options.project,
					});
					const mode = parseMode({ mode: options.mode });
					const threadMode = parseThreadMode({ thread: options.thread });
					const timeout = parseTimeout({ timeout: options.timeout });
					const taskText = parseTaskText({ parts: taskParts });
					if (mode === VALID_MODE.ONESHOT && !taskText) {
						throw new Error("oneshot mode requires a task message");
					}
					if (options.cwd) {
						ensureAbsolutePath({ cwd: options.cwd });
					}

					const runtimeOptions: HarnessRuntimeOptions = {};
					if (options.model) runtimeOptions.model = options.model;
					if (options.permissions) {
						runtimeOptions.permissions = parsePermissionValue({
							value: options.permissions,
						});
					}
					if (timeout !== undefined) runtimeOptions.timeout = timeout;
					if (options.cwd) runtimeOptions.cwd = options.cwd;

					const prompt = buildPrompt({
						taskText,
						mode,
						runtimeOptions,
					});

					const spawnConfig = applySpawnOverrides({
						config: context.config,
						projectId,
						agentId,
						runtimeOptions,
					});
					const sm = await getSessionManager(spawnConfig);
					const session = await sm.spawn({
						projectId,
						agent: agentId,
						prompt,
					});
					const key = makeSessionKey({
						agentId,
						sessionId: session.id,
					});
					const now = new Date().toISOString();
					const record: HarnessSessionRecord = {
						key,
						sessionId: session.id,
						agentId,
						projectId,
						mode,
						threadMode,
						label: options.label,
						runtimeOptions,
						createdAt: now,
						updatedAt: now,
					};
					updateRecord({ context, record });

					console.log(chalk.green(`Spawned harness session ${key}`));
					console.log(chalk.dim(`  sessionId: ${session.id}`));
					console.log(chalk.dim(`  project:   ${projectId}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to spawn harness session: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("status")
		.description("Show harness session state")
		.argument("[target]", "Session target (key, session id, or label)")
		.option("--json", "Output JSON")
		.action(async (target: string | undefined, options: HarnessStatusOptions) => {
			try {
				const context = getTargetContext();
				await showStatus({
					context,
					target,
					json: options.json,
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to fetch harness status: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("sessions")
		.description("List harness sessions")
		.option("--json", "Output JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const context = getTargetContext();
				await showStatus({
					context,
					json: options.json,
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to list harness sessions: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("steer")
		.description("Send steer instruction to target harness session")
		.argument("<instruction...>", "Instruction text")
		.option("-s, --session <target>", "Session target")
		.action(
			async (instructionParts: string[], options: HarnessTargetOptions) => {
				try {
					const instruction = parseInstruction({ parts: instructionParts });
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					await sendSteer({
						record,
						context,
						message: instruction,
					});
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					console.log(chalk.green(`Steered ${record.key}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to steer harness session: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("cancel")
		.description("Cancel current turn on target harness session")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				await runCancel({
					record,
					context,
				});
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Cancelled active turn for ${record.key}`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to cancel harness session: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("close")
		.description("Close target harness session and remove tracking")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				const sm = await getSessionManagerForContext({ context });
				try {
					await sm.kill(record.sessionId);
				} catch {
					// Best effort close; still remove the local tracking record.
				}
				removeSessionFromStore({
					store: context.store,
					key: record.key,
				});
				saveStore({
					storePath: context.storePath,
					store: context.store,
				});
				console.log(chalk.green(`Closed ${record.key}`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to close harness session: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("relay")
		.description(
			"Run team<->harness bridge loop (inbox messages to harness; harness output back to peers)"
		)
		.requiredOption("--team <id>", "Team identifier")
		.requiredOption("--member <name>", "Team member bound to the harness session")
		.option(
			"--to <members>",
			"Comma-separated peer list (defaults to all members except --member)"
		)
		.option("--root <path>", "Team root directory (default ~/.claude/teams)")
		.option("-s, --session <target>", "Session target")
		.option("--interval <ms>", "Polling interval in milliseconds", "1500")
		.option("--batch <count>", "Unread inbox batch size per poll", "20")
		.option("--lines <count>", "Captured tmux output lines per poll", "120")
		.option(
			"--max-chars <count>",
			"Maximum outbound relay payload size per poll",
			"4000"
		)
		.option("--once", "Run one relay cycle then exit")
		.option("--no-output", "Disable harness->team output relay")
		.option(
			"--emit-initial-output",
			"Forward current harness output snapshot on the first poll"
		)
		.action(async (options: HarnessRelayOptions): Promise<void> => {
			const signalController = createRelaySignalController();
			try {
				const parsed = parseRelayOptions({ options });
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				const teamManager = createTeamManager({
					rootDir: parsed.rootDir,
				});
				const peers = await resolveRelayPeers({
					teamManager,
					teamId: parsed.teamId,
					member: parsed.member,
					to: options.to,
				});
				if (parsed.outputEnabled && peers.length === 0) {
					throw new Error(
						"No relay peers found. Add another member or use --to/--no-output."
					);
				}
				const sm = await getSessionManagerForContext({ context });
				const relayConfig: RelayRunConfig = {
					...parsed,
					peers,
					record,
					teamManager,
					sm,
				};
				const state: RelayState = {
					previousOutput: null,
				};

				console.log(
					chalk.green(
						`Relay started for ${record.key} (team=${parsed.teamId}, member=${parsed.member})`
					)
				);
				if (parsed.outputEnabled) {
					console.log(chalk.dim(`  outbound peers: ${peers.join(", ")}`));
				}

				while (!signalController.isStopped()) {
					try {
						const result = await runRelayCycle({
							config: relayConfig,
							state,
						});
						if (result.inboundCount > 0 || result.outboundCount > 0) {
							record.updatedAt = new Date().toISOString();
							updateRecord({ context, record });
							console.log(
								chalk.dim(
									`[relay] inbound=${result.inboundCount} outbound=${result.outboundCount}`
								)
							);
						}
					} catch (error) {
						if (parsed.once) {
							throw error;
						}
						const message =
							error instanceof Error ? error.message : String(error);
						console.error(chalk.red(`Relay cycle error: ${message}`));
					}

					if (parsed.once) {
						break;
					}
					await sleep({ ms: parsed.intervalMs });
				}

				console.log(chalk.green(`Relay stopped for ${record.key}`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to run harness relay: ${message}`));
				process.exit(1);
			} finally {
				signalController.dispose();
			}
		});

	harness
		.command("model")
		.description("Set model runtime option for target harness session")
		.argument("<model-id>", "Model identifier")
		.option("-s, --session <target>", "Session target")
		.option("--apply", "Send steer message to apply now")
		.action(
			async (modelId: string, options: HarnessOptionSetOptions): Promise<void> => {
				try {
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions.model = modelId;
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					if (options.apply) {
						await sendSteer({
							record,
							context,
							message: `Use model '${modelId}' for subsequent turns if supported.`,
						});
					}
					console.log(chalk.green(`Set model on ${record.key}: ${modelId}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(`Failed to update harness model option: ${message}`)
					);
					process.exit(1);
				}
			}
		);

	harness
		.command("permissions")
		.description("Set permissions runtime option for target harness session")
		.argument("<profile>", "Permission profile")
		.option("-s, --session <target>", "Session target")
		.option("--apply", "Send steer message to apply now")
		.action(
			async (profile: string, options: HarnessOptionSetOptions): Promise<void> => {
				try {
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions.permissions = parsePermissionValue({
						value: profile,
					});
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					if (options.apply) {
						await sendSteer({
							record,
							context,
							message: `Use permissions profile '${profile}' for subsequent turns if supported.`,
						});
					}
					console.log(chalk.green(`Set permissions on ${record.key}: ${profile}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(
						chalk.red(`Failed to update harness permissions option: ${message}`)
					);
					process.exit(1);
				}
			}
		);

	harness
		.command("timeout")
		.description("Set timeout runtime option for target harness session")
		.argument("<seconds>", "Timeout in seconds")
		.option("-s, --session <target>", "Session target")
		.action(async (seconds: string, options: HarnessTargetOptions) => {
			try {
				const timeout = parseTimeout({ timeout: seconds });
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions.timeout = timeout;
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Set timeout on ${record.key}: ${timeout}s`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(
					chalk.red(`Failed to update harness timeout option: ${message}`)
				);
				process.exit(1);
			}
		});

	harness
		.command("cwd")
		.description("Set working directory runtime option for target harness session")
		.argument("<path>", "Absolute directory path")
		.option("-s, --session <target>", "Session target")
		.action(async (cwd: string, options: HarnessTargetOptions) => {
			try {
				ensureAbsolutePath({ cwd });
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions.cwd = cwd;
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Set cwd on ${record.key}: ${cwd}`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to update harness cwd option: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("set")
		.description("Set a generic runtime option key/value for target session")
		.argument("<key>", "Option key")
		.argument("<value>", "Option value")
		.option("-s, --session <target>", "Session target")
		.action(
			async (
				key: string,
				value: string,
				options: HarnessTargetOptions
			): Promise<void> => {
				try {
					if (!key.trim()) {
						throw new Error("key is required");
					}
					if (key === "cwd") {
						ensureAbsolutePath({ cwd: value });
					}
					const parsedValue = parseKeyValue({ key, value });
					const context = getTargetContext();
					const { record } = resolveTarget({
						context,
						target: options.session,
					});
					record.runtimeOptions[key] = parsedValue;
					record.updatedAt = new Date().toISOString();
					updateRecord({ context, record });
					console.log(chalk.green(`Set ${key} on ${record.key}: ${value}`));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(chalk.red(`Failed to set runtime option: ${message}`));
					process.exit(1);
				}
			}
		);

	harness
		.command("reset-options")
		.description("Clear all runtime option overrides for target session")
		.option("-s, --session <target>", "Session target")
		.action(async (options: HarnessTargetOptions) => {
			try {
				const context = getTargetContext();
				const { record } = resolveTarget({
					context,
					target: options.session,
				});
				record.runtimeOptions = {};
				record.updatedAt = new Date().toISOString();
				updateRecord({ context, record });
				console.log(chalk.green(`Reset runtime options for ${record.key}`));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to reset runtime options: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("doctor")
		.description("Check harness command health and environment")
		.action(async () => {
			try {
				const context = getTargetContext();
				const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
				checks.push({
					name: "config",
					ok: true,
					detail: context.config.configPath ?? "(resolved)",
				});
				checks.push({
					name: "store",
					ok: true,
					detail: context.storePath,
				});
				try {
					await exec("tmux", ["-V"]);
					checks.push({ name: "tmux", ok: true, detail: "available" });
				} catch {
					checks.push({ name: "tmux", ok: false, detail: "not found" });
				}
				for (const check of checks) {
					const icon = check.ok ? chalk.green("OK") : chalk.yellow("WARN");
					console.log(`${icon} ${check.name}: ${check.detail}`);
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Harness doctor failed: ${message}`));
				process.exit(1);
			}
		});

	harness
		.command("install")
		.description("Print deterministic harness setup instructions")
		.action(() => {
			try {
				printInstallInstructions();
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Failed to print install guidance: ${message}`));
				process.exit(1);
			}
		});
}
