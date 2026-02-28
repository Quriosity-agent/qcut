import {
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { expandHome } from "./paths.js";

const SAFE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const JSON_INDENT = 2;

export const TEAM_PROTOCOL_TYPE = {
	IDLE_NOTIFICATION: "idle_notification",
	SHUTDOWN_REQUEST: "shutdown_request",
	SHUTDOWN_APPROVED: "shutdown_approved",
} as const;

export interface TeamMessage {
	from: string;
	text: string;
	timestamp: string;
	read: boolean;
	summary?: string;
	color?: string;
}

export interface TeamProtocolPayload
	extends Record<string, unknown> {
	type: string;
	from: string;
}

export interface TeamManagerConfig {
	rootDir?: string;
	lockTimeoutMs?: number;
	lockRetryMs?: number;
}

export interface TeamDefinition {
	teamId: string;
	rootDir: string;
	teamDir: string;
	inboxesDir: string;
	members: string[];
}

export interface TeamSendMessageInput {
	teamId: string;
	from: string;
	to: string;
	text: string;
	summary?: string;
	color?: string;
	timestamp?: string;
	read?: boolean;
}

export interface TeamSendProtocolInput {
	teamId: string;
	from: string;
	to: string;
	type: string;
	payload?: Record<string, unknown>;
	summary?: string;
	color?: string;
	timestamp?: string;
	read?: boolean;
}

export interface TeamReadInboxInput {
	teamId: string;
	member: string;
	unreadOnly?: boolean;
	markAsRead?: boolean;
	limit?: number;
}

export interface TeamManager {
	ensureTeam(input: { teamId: string; members: string[] }): Promise<TeamDefinition>;
	addMember(input: { teamId: string; member: string }): Promise<void>;
	listMembers(input: { teamId: string }): Promise<string[]>;
	sendMessage(input: TeamSendMessageInput): Promise<TeamMessage>;
	sendProtocol(input: TeamSendProtocolInput): Promise<TeamMessage>;
	readInbox(input: TeamReadInboxInput): Promise<TeamMessage[]>;
	markAllRead(input: { teamId: string; member: string }): Promise<number>;
	getPaths(input: { teamId: string; member?: string }): TeamDefinition & {
		inboxPath?: string;
	};
}

function sleep({ ms }: { ms: number }): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function assertSafePathPart({
	value,
	label,
}: {
	value: string;
	label: string;
}): void {
	if (!SAFE_PATH_PART.test(value)) {
		throw new Error(
			`${label} contains invalid characters. Allowed: letters, numbers, ., _, -`
		);
	}
}

function normalizeMessage({
	entry,
}: {
	entry: unknown;
}): TeamMessage | null {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		return null;
	}

	const raw = entry as Record<string, unknown>;
	if (typeof raw.from !== "string" || typeof raw.text !== "string") {
		return null;
	}

	const normalized: TeamMessage = {
		from: raw.from,
		text: raw.text,
		timestamp:
			typeof raw.timestamp === "string"
				? raw.timestamp
				: new Date().toISOString(),
		read: typeof raw.read === "boolean" ? raw.read : false,
	};

	if (typeof raw.summary === "string") {
		normalized.summary = raw.summary;
	}
	if (typeof raw.color === "string") {
		normalized.color = raw.color;
	}

	return normalized;
}

function readInboxMessages({
	inboxPath,
}: {
	inboxPath: string;
}): TeamMessage[] {
	if (!existsSync(inboxPath)) {
		return [];
	}

	const content = readFileSync(inboxPath, "utf-8").trim();
	if (!content) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		throw new Error(`Inbox file is not valid JSON: ${inboxPath}`, {
			cause: error,
		});
	}

	if (!Array.isArray(parsed)) {
		throw new Error(`Inbox file must contain a JSON array: ${inboxPath}`);
	}

	const messages: TeamMessage[] = [];
	for (const entry of parsed) {
		const normalized = normalizeMessage({ entry });
		if (normalized !== null) {
			messages.push(normalized);
		}
	}
	return messages;
}

function writeInboxMessages({
	inboxPath,
	messages,
}: {
	inboxPath: string;
	messages: TeamMessage[];
}): void {
	const tempPath = `${inboxPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(
			tempPath,
			`${JSON.stringify(messages, null, JSON_INDENT)}\n`,
			"utf-8"
		);
		renameSync(tempPath, inboxPath);
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

function ensureInboxFile({
	inboxPath,
}: {
	inboxPath: string;
}): void {
	mkdirSync(dirname(inboxPath), { recursive: true });
	if (!existsSync(inboxPath)) {
		writeFileSync(inboxPath, "[]\n", "utf-8");
	}
}

function normalizeLimit({
	limit,
}: {
	limit?: number;
}): number | null {
	if (limit === undefined) {
		return null;
	}
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("limit must be a positive integer");
	}
	return limit;
}

async function withInboxLock<T>({
	inboxPath,
	lockTimeoutMs,
	lockRetryMs,
	operation,
}: {
	inboxPath: string;
	lockTimeoutMs: number;
	lockRetryMs: number;
	operation: () => Promise<T> | T;
}): Promise<T> {
	const lockPath = `${inboxPath}.lock`;
	const start = Date.now();

	while (true) {
		try {
			const lockFd = openSync(
				lockPath,
				constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
			);
			closeSync(lockFd);

			try {
				return await operation();
			} finally {
				try {
					unlinkSync(lockPath);
				} catch {
					// Best effort lock cleanup.
				}
			}
		} catch (error) {
			if (Date.now() - start >= lockTimeoutMs) {
				throw new Error(`Timed out acquiring lock for ${inboxPath}`, {
					cause: error,
				});
			}
			await sleep({ ms: lockRetryMs });
		}
	}
}

export function parseTeamProtocolMessage({
	message,
}: {
	message: TeamMessage;
}): TeamProtocolPayload | null {
	try {
		const parsed = JSON.parse(message.text) as unknown;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return null;
		}

		const payload = parsed as Record<string, unknown>;
		if (typeof payload.type !== "string" || typeof payload.from !== "string") {
			return null;
		}

		return payload as TeamProtocolPayload;
	} catch {
		return null;
	}
}

export function createTeamManager({
	rootDir = "~/.claude/teams",
	lockTimeoutMs = 5_000,
	lockRetryMs = 50,
}: TeamManagerConfig = {}): TeamManager {
	const resolvedRootDir = expandHome(rootDir);

	function getPaths({
		teamId,
		member,
	}: {
		teamId: string;
		member?: string;
	}): TeamDefinition & { inboxPath?: string } {
		assertSafePathPart({ value: teamId, label: "teamId" });
		const teamDir = join(resolvedRootDir, teamId);
		const inboxesDir = join(teamDir, "inboxes");
		const base: TeamDefinition = {
			teamId,
			rootDir: resolvedRootDir,
			teamDir,
			inboxesDir,
			members: [],
		};

		if (!member) {
			return base;
		}

		assertSafePathPart({ value: member, label: "member" });
		return {
			...base,
			inboxPath: join(inboxesDir, `${member}.json`),
		};
	}

	async function ensureTeam({
		teamId,
		members,
	}: {
		teamId: string;
		members: string[];
	}): Promise<TeamDefinition> {
		try {
			if (members.length < 1) {
				throw new Error("at least one team member is required");
			}

			const paths = getPaths({ teamId });
			mkdirSync(paths.inboxesDir, { recursive: true });

			const uniqueMembers = [...new Set(members)];
			for (const member of uniqueMembers) {
				const memberPaths = getPaths({ teamId, member });
				ensureInboxFile({ inboxPath: memberPaths.inboxPath! });
			}

			return {
				...paths,
				members: await listMembers({ teamId }),
			};
		} catch (error) {
			throw new Error(`Failed to initialize team '${teamId}'`, {
				cause: error,
			});
		}
	}

	async function addMember({
		teamId,
		member,
	}: {
		teamId: string;
		member: string;
	}): Promise<void> {
		try {
			const paths = getPaths({ teamId, member });
			ensureInboxFile({ inboxPath: paths.inboxPath! });
		} catch (error) {
			throw new Error(`Failed to add member '${member}' to team '${teamId}'`, {
				cause: error,
			});
		}
	}

	async function listMembers({
		teamId,
	}: {
		teamId: string;
	}): Promise<string[]> {
		try {
			const paths = getPaths({ teamId });
			if (!existsSync(paths.inboxesDir)) {
				return [];
			}

			const members: string[] = [];
			for (const fileName of readdirSync(paths.inboxesDir)) {
				if (!fileName.endsWith(".json")) {
					continue;
				}
				const memberName = fileName.slice(0, -5);
				if (SAFE_PATH_PART.test(memberName)) {
					members.push(memberName);
				}
			}

			members.sort((a, b) => a.localeCompare(b));
			return members;
		} catch (error) {
			throw new Error(`Failed to list members for team '${teamId}'`, {
				cause: error,
			});
		}
	}

	async function sendMessage({
		teamId,
		from,
		to,
		text,
		summary,
		color,
		timestamp,
		read,
	}: TeamSendMessageInput): Promise<TeamMessage> {
		try {
			const paths = getPaths({ teamId, member: to });
			const inboxPath = paths.inboxPath!;
			mkdirSync(paths.inboxesDir, { recursive: true });

			const message: TeamMessage = {
				from,
				text,
				timestamp: timestamp ?? new Date().toISOString(),
				read: read ?? false,
			};
			if (summary !== undefined) {
				message.summary = summary;
			}
			if (color !== undefined) {
				message.color = color;
			}

			await withInboxLock({
				inboxPath,
				lockTimeoutMs,
				lockRetryMs,
				operation: () => {
					ensureInboxFile({ inboxPath });
					const messages = readInboxMessages({ inboxPath });
					messages.push(message);
					writeInboxMessages({ inboxPath, messages });
				},
			});

			return message;
		} catch (error) {
			throw new Error(`Failed to send message to '${to}' in team '${teamId}'`, {
				cause: error,
			});
		}
	}

	async function sendProtocol({
		teamId,
		from,
		to,
		type,
		payload,
		summary,
		color,
		timestamp,
		read,
	}: TeamSendProtocolInput): Promise<TeamMessage> {
		try {
			const protocolPayload: TeamProtocolPayload = {
				type,
				from,
			};
			if (payload) {
				for (const [key, value] of Object.entries(payload)) {
					if (key === "type" || key === "from") {
						continue;
					}
					protocolPayload[key] = value;
				}
			}

			return await sendMessage({
				teamId,
				from,
				to,
				text: JSON.stringify(protocolPayload),
				summary,
				color,
				timestamp,
				read,
			});
		} catch (error) {
			throw new Error(`Failed to send protocol message to '${to}'`, {
				cause: error,
			});
		}
	}

	async function readInbox({
		teamId,
		member,
		unreadOnly = false,
		markAsRead = false,
		limit,
	}: TeamReadInboxInput): Promise<TeamMessage[]> {
		try {
			const paths = getPaths({ teamId, member });
			const inboxPath = paths.inboxPath!;
			const normalizedLimit = normalizeLimit({ limit });
			mkdirSync(paths.inboxesDir, { recursive: true });

			const readOperation = (): TeamMessage[] => {
				ensureInboxFile({ inboxPath });
				const allMessages = readInboxMessages({ inboxPath });
				const matchingIndexes: number[] = [];

				for (let index = 0; index < allMessages.length; index++) {
					const current = allMessages[index];
					if (unreadOnly && current.read) {
						continue;
					}
					matchingIndexes.push(index);
				}

				const startIndex =
					normalizedLimit === null
						? 0
						: Math.max(0, matchingIndexes.length - normalizedLimit);
				const selectedIndexes = matchingIndexes.slice(startIndex);

				if (markAsRead) {
					for (const index of selectedIndexes) {
						const current = allMessages[index];
						allMessages[index] = { ...current, read: true };
					}
					writeInboxMessages({ inboxPath, messages: allMessages });
				}

				const selectedMessages: TeamMessage[] = [];
				for (const index of selectedIndexes) {
					selectedMessages.push(allMessages[index]);
				}
				return selectedMessages;
			};

			if (markAsRead) {
				return await withInboxLock({
					inboxPath,
					lockTimeoutMs,
					lockRetryMs,
					operation: readOperation,
				});
			}

			ensureInboxFile({ inboxPath });
			return readOperation();
		} catch (error) {
			throw new Error(
				`Failed to read inbox for member '${member}' in team '${teamId}'`,
				{ cause: error }
			);
		}
	}

	async function markAllRead({
		teamId,
		member,
	}: {
		teamId: string;
		member: string;
	}): Promise<number> {
		try {
			const paths = getPaths({ teamId, member });
			const inboxPath = paths.inboxPath!;
			mkdirSync(paths.inboxesDir, { recursive: true });

			return await withInboxLock({
				inboxPath,
				lockTimeoutMs,
				lockRetryMs,
				operation: () => {
					ensureInboxFile({ inboxPath });
					const allMessages = readInboxMessages({ inboxPath });
					let updatedCount = 0;
					for (let index = 0; index < allMessages.length; index++) {
						if (allMessages[index].read) {
							continue;
						}
						allMessages[index] = { ...allMessages[index], read: true };
						updatedCount++;
					}
					if (updatedCount > 0) {
						writeInboxMessages({ inboxPath, messages: allMessages });
					}
					return updatedCount;
				},
			});
		} catch (error) {
			throw new Error(
				`Failed to mark inbox as read for member '${member}' in team '${teamId}'`,
				{ cause: error }
			);
		}
	}

	return {
		ensureTeam,
		addMember,
		listMembers,
		sendMessage,
		sendProtocol,
		readInbox,
		markAllRead,
		getPaths,
	};
}
