import chalk from "chalk";
import {
	createTeamManager,
	parseTeamProtocolMessage,
	type TeamManager,
	type TeamMessage,
} from "@composio/ao-core";
import { getSessionManager } from "../lib/create-session-manager.js";
import { exec } from "../lib/shell.js";
import {
	parseNonNegativeIntegerOption,
	parsePositiveIntegerOption,
	parseRelayOutputMode,
	resolveTeamRoot,
} from "./harness-options.js";
import {
	RELAY_DEFAULT_DEDUP_CACHE_SIZE,
	RELAY_DEFAULT_PROTOCOL_TTL,
	RELAY_OUTPUT_MODE,
	RELAY_PROTOCOL_PREFIX,
	type HarnessRelayOptions,
	type HarnessSessionRecord,
	type HarnessStoreContext,
	type RelayParsedOptions,
	type RelayRunConfig,
	type RelaySignalController,
	type RelayState,
} from "./harness-types.js";

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
		outputMode: parseRelayOutputMode({ value: options.outputMode }),
		protocolTTL:
			parseNonNegativeIntegerOption({
				value: options.protocolTtl,
				flag: "--protocol-ttl",
			}) ?? RELAY_DEFAULT_PROTOCOL_TTL,
		dedupCacheSize:
			parsePositiveIntegerOption({
				value: options.dedupCache,
				flag: "--dedup-cache",
			}) ?? RELAY_DEFAULT_DEDUP_CACHE_SIZE,
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
			return uniqueRequested.filter((peer) => peer !== member);
		}

		return members.filter((candidate) => candidate !== member);
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

function isLegacyRelayNoiseMessage({
	message,
}: {
	message: TeamMessage;
}): boolean {
	try {
		const summary = message.summary ?? "";
		if (summary.startsWith("relay:")) {
			return true;
		}
		return message.text.startsWith("[qagent-harness-relay]");
	} catch {
		return false;
	}
}

function parseProtocolId({
	value,
}: {
	value: unknown;
}): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return trimmed;
}

function parseProtocolTTL({
	value,
}: {
	value: unknown;
}): number | null {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	return null;
}

function buildRelayMessageId({
	member,
	payload,
}: {
	member: string;
	payload?: string;
}): string {
	const seed = payload ?? `${Date.now()}-${Math.random()}`;
	let hash = 0;
	for (let index = 0; index < seed.length; index++) {
		hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
	}
	return ["relay", member, hash.toString(36), Date.now().toString(36)].join("-");
}

function markProtocolSeen({
	state,
	id,
	maxSize,
}: {
	state: RelayState;
	id: string;
	maxSize: number;
}): boolean {
	if (state.seenProtocolIds.has(id)) {
		return false;
	}
	state.seenProtocolIds.add(id);
	state.seenProtocolOrder.push(id);
	while (state.seenProtocolOrder.length > maxSize) {
		const evicted = state.seenProtocolOrder.shift();
		if (!evicted) {
			continue;
		}
		state.seenProtocolIds.delete(evicted);
	}
	return true;
}

function parseProtocolFromInlineJSON({
	value,
}: {
	value: string;
}): TeamMessage | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		const candidate = parsed as Record<string, unknown>;
		if (typeof candidate.type !== "string" || typeof candidate.from !== "string") {
			return null;
		}
		return {
			from: candidate.from,
			text: JSON.stringify(candidate),
			timestamp: new Date().toISOString(),
			read: false,
		};
	} catch {
		return null;
	}
}

function extractProtocolPayloadsFromOutput({
	delta,
}: {
	delta: string;
}): TeamMessage[] {
	try {
		const lines = splitLines({ value: delta });
		const extracted: TeamMessage[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			let jsonCandidate: string | null = null;
			if (trimmed.startsWith(RELAY_PROTOCOL_PREFIX)) {
				jsonCandidate = trimmed.slice(RELAY_PROTOCOL_PREFIX.length).trim();
			}
			if (!jsonCandidate && trimmed.startsWith("{") && trimmed.endsWith("}")) {
				jsonCandidate = trimmed;
			}
			if (!jsonCandidate) {
				continue;
			}
			const parsed = parseProtocolFromInlineJSON({ value: jsonCandidate });
			if (parsed) {
				extracted.push(parsed);
			}
		}
		return extracted;
	} catch {
		return [];
	}
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
		if (emitInitialOutput) {
			return nextOutput;
		}
		return null;
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
	sm: RelayRunConfig["sm"];
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
		], { timeout: 10_000 });
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
	state,
	dedupCacheSize,
}: {
	teamManager: TeamManager;
	teamId: string;
	member: string;
	batchSize: number;
	record: HarnessSessionRecord;
	sm: RelayRunConfig["sm"];
	state: RelayState;
	dedupCacheSize: number;
}): Promise<number> {
	try {
		const inbound = await teamManager.readInbox({
			teamId,
			member,
			unreadOnly: true,
			markAsRead: true,
			limit: batchSize,
		});
		const forwardable = inbound.filter((message) => {
			if (message.from === member) {
				return false;
			}
			const protocol = parseTeamProtocolMessage({ message });
			if (!protocol) {
				return !isLegacyRelayNoiseMessage({ message });
			}
			const protocolId = parseProtocolId({ value: protocol.id });
			if (!protocolId) {
				return true;
			}
			return markProtocolSeen({
				state,
				id: protocolId,
				maxSize: dedupCacheSize,
			});
		});
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
	outputMode,
	protocolTTL,
	dedupCacheSize,
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
	outputMode: RelayParsedOptions["outputMode"];
	protocolTTL: number;
	dedupCacheSize: number;
	emitInitialOutput: boolean;
	sm: RelayRunConfig["sm"];
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

		if (outputMode === RELAY_OUTPUT_MODE.RAW) {
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
		}

		const protocolMessages = extractProtocolPayloadsFromOutput({ delta });
		if (protocolMessages.length === 0) {
			return 0;
		}

		let sentCount = 0;
		for (const protocolMessage of protocolMessages) {
			const protocol = parseTeamProtocolMessage({
				message: protocolMessage,
			});
			if (!protocol) {
				continue;
			}
			const ttl = parseProtocolTTL({ value: protocol.ttl }) ?? protocolTTL;
			if (ttl <= 0) {
				continue;
			}
			const protocolId =
				parseProtocolId({ value: protocol.id }) ??
				buildRelayMessageId({
					member,
					payload: JSON.stringify(protocol),
				});
			const isNew = markProtocolSeen({
				state,
				id: protocolId,
				maxSize: dedupCacheSize,
			});
			if (!isNew) {
				continue;
			}

			const nextTTL = ttl - 1;
			const payload: Record<string, unknown> = {
				...protocol,
				id: protocolId,
				ttl: nextTTL,
			};
			for (const peer of peers) {
				await teamManager.sendProtocol({
					teamId,
					from: member,
					to: peer,
					type: protocol.type,
					payload,
					summary: `relay-protocol:${protocol.type}`,
					color: "cyan",
					read: false,
				});
				sentCount += 1;
			}
		}

		return sentCount;
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
			state,
			dedupCacheSize: config.dedupCacheSize,
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
				outputMode: config.outputMode,
				protocolTTL: config.protocolTTL,
				dedupCacheSize: config.dedupCacheSize,
				emitInitialOutput: config.emitInitialOutput,
				sm: config.sm,
			});
		}

		return { inboundCount, outboundCount };
	} catch (error) {
		throw new Error("Relay cycle failed", { cause: error });
	}
}

export async function runHarnessRelay({
	options,
	context,
	record,
	onActivity,
}: {
	options: HarnessRelayOptions;
	context: HarnessStoreContext;
	record: HarnessSessionRecord;
	onActivity: () => void;
}): Promise<void> {
	const signalController = createRelaySignalController();
	try {
		const parsed = parseRelayOptions({ options });
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
		const sm = await getSessionManager(context.config);
		const relayConfig: RelayRunConfig = {
			...parsed,
			peers,
			record,
			teamManager,
			sm,
		};
		const state: RelayState = {
			previousOutput: null,
			seenProtocolIds: new Set<string>(),
			seenProtocolOrder: [],
		};

		console.log(
			chalk.green(
				`Relay started for ${record.key} (team=${parsed.teamId}, member=${parsed.member})`
			)
		);
		if (parsed.outputEnabled) {
			console.log(chalk.dim(`  outbound peers: ${peers.join(", ")}`));
			console.log(chalk.dim(`  output mode: ${parsed.outputMode}`));
		}

		while (!signalController.isStopped()) {
			try {
				const result = await runRelayCycle({
					config: relayConfig,
					state,
				});
				if (result.inboundCount > 0 || result.outboundCount > 0) {
					onActivity();
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
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Relay cycle error: ${message}`));
			}

			if (parsed.once) {
				break;
			}
			await sleep({ ms: parsed.intervalMs });
		}

		console.log(chalk.green(`Relay stopped for ${record.key}`));
	} finally {
		signalController.dispose();
	}
}
