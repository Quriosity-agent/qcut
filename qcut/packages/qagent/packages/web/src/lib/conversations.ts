import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SAFE_TEAM_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;

export interface LeadConversationMessage {
	from: string;
	text: string;
	summary: string | null;
	timestamp: string | null;
	read: boolean | null;
	color: string | null;
}

export interface LeadConversationSnapshot {
	rootDir: string;
	teamId: string | null;
	inboxPath: string | null;
	total: number;
	updatedAt: string | null;
	messages: LeadConversationMessage[];
}

interface TeamCandidate {
	teamId: string;
	inboxPath: string;
	updatedAtMs: number;
}

interface RootSelection {
	rootDir: string;
	team: TeamCandidate;
}

function clampLimit({
	limit,
}: {
	limit: number | undefined;
}): number {
	if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
	if (limit < 1) return 1;
	if (limit > MAX_LIMIT) return MAX_LIMIT;
	return limit;
}

function toRootDir({
	rootDir,
}: {
	rootDir: string | undefined;
}): string {
	if (!rootDir || rootDir.trim().length === 0) {
		return resolve(join(homedir(), ".claude", "teams"));
	}
	return resolve(rootDir.trim());
}

function getRootCandidates({
	rootDir,
}: {
	rootDir: string | undefined;
}): string[] {
	if (rootDir && rootDir.trim().length > 0) {
		return [toRootDir({ rootDir })];
	}
	const candidates = [
		resolve(join(homedir(), ".claude", "teams")),
		resolve(join(homedir(), "Desktop", ".qagent-teams")),
	];
	return Array.from(new Set(candidates));
}

function assertSafeTeamId({
	teamId,
}: {
	teamId: string;
}): void {
	if (!SAFE_TEAM_ID_PATTERN.test(teamId)) {
		throw new Error(`Invalid team id '${teamId}'`);
	}
}

function toMessage({
	value,
}: {
	value: unknown;
}): LeadConversationMessage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const obj = value as Record<string, unknown>;
	const from = typeof obj.from === "string" ? obj.from : "unknown";
	const text = typeof obj.text === "string" ? obj.text : "";
	const summary = typeof obj.summary === "string" ? obj.summary : null;
	const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null;
	const read = typeof obj.read === "boolean" ? obj.read : null;
	const color = typeof obj.color === "string" ? obj.color : null;
	return {
		from,
		text,
		summary,
		timestamp,
		read,
		color,
	};
}

async function listTeamCandidates({
	rootDir,
}: {
	rootDir: string;
}): Promise<TeamCandidate[]> {
	try {
		const entries = await readdir(rootDir, { withFileTypes: true });
		const teamIds = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		const candidates = await Promise.all(
			teamIds.map(async (teamId): Promise<TeamCandidate | null> => {
				const inboxPath = join(rootDir, teamId, "inboxes", "lead.json");
				try {
					const inboxStat = await stat(inboxPath);
					return {
						teamId,
						inboxPath,
						updatedAtMs: inboxStat.mtimeMs,
					};
				} catch {
					return null;
				}
			}),
		);
		return candidates
			.filter((candidate): candidate is TeamCandidate => candidate !== null)
			.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) {
			const code = (error as { code?: unknown }).code;
			if (code === "ENOENT") {
				return [];
			}
		}
		throw new Error(`Failed to list teams from '${rootDir}'`, { cause: error });
	}
}

async function resolveTeam({
	rootDir,
	teamId,
}: {
	rootDir: string;
	teamId: string | undefined;
}): Promise<TeamCandidate | null> {
	if (teamId) {
		assertSafeTeamId({ teamId });
		const inboxPath = join(rootDir, teamId, "inboxes", "lead.json");
		try {
			const inboxStat = await stat(inboxPath);
			return {
				teamId,
				inboxPath,
				updatedAtMs: inboxStat.mtimeMs,
			};
		} catch {
			return null;
		}
	}
	const candidates = await listTeamCandidates({ rootDir });
	if (candidates.length === 0) return null;
	return candidates[0];
}

export async function readLeadConversation({
	rootDir,
	teamId,
	limit,
}: {
	rootDir?: string;
	teamId?: string;
	limit?: number;
}): Promise<LeadConversationSnapshot> {
	try {
		const boundedLimit = clampLimit({ limit });
		const rootCandidates = getRootCandidates({ rootDir });
		const selections = await Promise.all(
			rootCandidates.map(async (candidateRoot): Promise<RootSelection | null> => {
				const selected = await resolveTeam({
					rootDir: candidateRoot,
					teamId,
				});
				if (!selected) return null;
				return {
					rootDir: candidateRoot,
					team: selected,
				};
			}),
		);
		const available = selections.filter(
			(selection): selection is RootSelection => selection !== null,
		);
		const selectedRoot = available.sort(
			(a, b) => b.team.updatedAtMs - a.team.updatedAtMs,
		)[0];

		if (!selectedRoot) {
			return {
				rootDir: rootCandidates[0] ?? toRootDir({ rootDir: undefined }),
				teamId: null,
				inboxPath: null,
				total: 0,
				updatedAt: null,
				messages: [],
			};
		}

		const raw = await readFile(selectedRoot.team.inboxPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			throw new Error("lead.json must contain a JSON array");
		}

		const allMessages = parsed
			.map((item) => toMessage({ value: item }))
			.filter((item): item is LeadConversationMessage => item !== null);

		return {
			rootDir: selectedRoot.rootDir,
			teamId: selectedRoot.team.teamId,
			inboxPath: selectedRoot.team.inboxPath,
			total: allMessages.length,
			updatedAt: new Date(selectedRoot.team.updatedAtMs).toISOString(),
			messages: allMessages.slice(-boundedLimit),
		};
	} catch (error) {
		throw new Error("Failed to read lead conversation", { cause: error });
	}
}
