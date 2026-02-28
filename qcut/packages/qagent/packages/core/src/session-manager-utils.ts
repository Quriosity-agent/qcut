import type { RuntimeHandle, Session, SessionId, SessionStatus } from "./types.js";

/** Escape regex metacharacters in a string. */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Get the next session number for a project. */
export function getNextSessionNumber(
	existingSessions: string[],
	prefix: string
): number {
	let max = 0;
	const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
	for (const name of existingSessions) {
		const match = name.match(pattern);
		if (match) {
			const num = parseInt(match[1], 10);
			if (num > max) {
				max = num;
			}
		}
	}
	return max + 1;
}

/** Safely parse JSON, returning null on failure. */
export function safeJsonParse<T>(str: string): T | null {
	try {
		return JSON.parse(str) as T;
	} catch {
		return null;
	}
}

/** Valid session statuses for validation. */
const VALID_STATUSES: ReadonlySet<string> = new Set([
	"spawning",
	"working",
	"pr_open",
	"ci_failed",
	"review_pending",
	"changes_requested",
	"approved",
	"mergeable",
	"merged",
	"cleanup",
	"needs_input",
	"stuck",
	"errored",
	"killed",
	"done",
	"terminated",
]);

/** Validate and normalize a status string. */
export function validateStatus(raw: string | undefined): SessionStatus {
	if (raw === "starting") {
		return "working";
	}
	if (raw && VALID_STATUSES.has(raw)) {
		return raw as SessionStatus;
	}
	return "spawning";
}

/** Reconstruct a Session object from raw metadata key=value pairs. */
export function metadataToSession(
	sessionId: SessionId,
	meta: Record<string, string>,
	createdAt?: Date,
	modifiedAt?: Date
): Session {
	return {
		id: sessionId,
		projectId: meta.project ?? "",
		status: validateStatus(meta.status),
		activity: null,
		branch: meta.branch || null,
		issueId: meta.issue || null,
		pr: meta.pr
			? (() => {
					const prUrl = meta.pr;
					const ghMatch = prUrl.match(
						/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
					);
					return {
						number: ghMatch
							? parseInt(ghMatch[3], 10)
							: parseInt(prUrl.match(/\/(\d+)$/)?.[1] ?? "0", 10),
						url: prUrl,
						title: "",
						owner: ghMatch?.[1] ?? "",
						repo: ghMatch?.[2] ?? "",
						branch: meta.branch ?? "",
						baseBranch: "",
						isDraft: false,
					};
				})()
			: null,
		workspacePath: meta.worktree || null,
		runtimeHandle: meta.runtimeHandle
			? safeJsonParse<RuntimeHandle>(meta.runtimeHandle)
			: null,
		agentInfo: meta.summary
			? { summary: meta.summary, agentSessionId: null }
			: null,
		createdAt: meta.createdAt
			? new Date(meta.createdAt)
			: (createdAt ?? new Date()),
		lastActivityAt: modifiedAt ?? new Date(),
		metadata: meta,
	};
}
