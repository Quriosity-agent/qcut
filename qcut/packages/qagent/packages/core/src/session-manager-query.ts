import { statSync } from "node:fs";
import { join } from "node:path";
import { readMetadataRaw } from "./metadata.js";
import type { Session, SessionId } from "./types.js";
import type { SessionManagerContext } from "./session-manager-internal-types.js";
import { metadataToSession } from "./session-manager-utils.js";

function readSessionTimestamps({
	sessionsDir,
	sessionName,
}: {
	sessionsDir: string;
	sessionName: string;
}): { createdAt?: Date; modifiedAt?: Date } {
	try {
		const metaPath = join(sessionsDir, sessionName);
		const stats = statSync(metaPath);
		return {
			createdAt: stats.birthtime,
			modifiedAt: stats.mtime,
		};
	} catch {
		return {};
	}
}

export async function listSessions({
	context,
	projectId,
}: {
	context: SessionManagerContext;
	projectId?: string;
}): Promise<Session[]> {
	const allSessions = context.listAllSessions(projectId);

	const sessionPromises = allSessions.map(
		async ({ sessionName, projectId: sessionProjectId }) => {
			const project = context.config.projects[sessionProjectId];
			if (!project) {
				return null;
			}

			const sessionsDir = context.getProjectSessionsDir(project);
			const raw = readMetadataRaw(sessionsDir, sessionName);
			if (!raw) {
				return null;
			}

			const { createdAt, modifiedAt } = readSessionTimestamps({
				sessionsDir,
				sessionName,
			});
			const session = metadataToSession(
				sessionName,
				raw,
				createdAt,
				modifiedAt
			);

			const plugins = context.resolvePlugins(project, raw.agent);
			const enrichTimeout = new Promise<void>((resolve) =>
				setTimeout(resolve, 2_000)
			);
			await Promise.race([
				context.ensureHandleAndEnrich(session, sessionName, project, plugins),
				enrichTimeout,
			]);

			return session;
		}
	);

	const results = await Promise.all(sessionPromises);
	return results.filter((s): s is Session => s !== null);
}

export async function getSession({
	context,
	sessionId,
}: {
	context: SessionManagerContext;
	sessionId: SessionId;
}): Promise<Session | null> {
	for (const project of Object.values(context.config.projects)) {
		const sessionsDir = context.getProjectSessionsDir(project);
		const raw = readMetadataRaw(sessionsDir, sessionId);
		if (!raw) {
			continue;
		}

		const { createdAt, modifiedAt } = readSessionTimestamps({
			sessionsDir,
			sessionName: sessionId,
		});
		const session = metadataToSession(sessionId, raw, createdAt, modifiedAt);

		const plugins = context.resolvePlugins(project, raw.agent);
		await context.ensureHandleAndEnrich(session, sessionId, project, plugins);

		return session;
	}

	return null;
}
