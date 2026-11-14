import type { EditorApiClient } from "./editor-api-client.js";

interface NavigatorProjects {
	activeProjectId?: string | null;
}

export interface ProjectReadyResult {
	projectId: string;
	/** The editor has the project open and its media and timeline answer. */
	ready: true;
	/** This command navigated the editor to the project. */
	opened: boolean;
	/** From the start of the command, the navigation included. */
	elapsedMs: number;
}

/** The project the editor has open, if any. */
export async function resolveActiveProjectId({
	client,
}: {
	client: EditorApiClient;
}): Promise<string | undefined> {
	const navigator = await client.get<NavigatorProjects>(
		"/api/claude/navigator/projects"
	);
	return navigator.activeProjectId ?? undefined;
}

const sleep = (durationMs: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export async function ensureEditorProjectReady({
	client,
	projectId,
	open = true,
	timeoutMs = 15_000,
	intervalMs = 150,
}: {
	client: EditorApiClient;
	projectId: string;
	open?: boolean;
	timeoutMs?: number;
	intervalMs?: number;
}): Promise<ProjectReadyResult> {
	const startedAt = Date.now();
	let opened = false;
	if (open) {
		const navigation = await client.post<{
			navigated?: boolean;
			projectId?: string;
			error?: string;
		}>("/api/claude/navigator/open", { projectId });
		if (navigation.navigated === false) {
			throw new Error(
				navigation.error ?? `QCut could not open project '${projectId}'`
			);
		}
		opened = true;
	}

	let lastError: unknown;
	while (Date.now() - startedAt <= Math.max(1, timeoutMs)) {
		try {
			const navigator = await client.get<NavigatorProjects>(
				"/api/claude/navigator/projects"
			);
			if (navigator.activeProjectId === projectId) {
				await Promise.all([
					client.get(`/api/claude/media/${encodeURIComponent(projectId)}`),
					client.get(`/api/claude/timeline/${encodeURIComponent(projectId)}`),
				]);
				return {
					projectId,
					ready: true,
					opened,
					elapsedMs: Date.now() - startedAt,
				};
			}
		} catch (error) {
			lastError = error;
		}
		await sleep(Math.max(20, intervalMs));
	}

	throw new Error(
		`Project '${projectId}' did not become editor-ready within ${timeoutMs}ms${
			lastError instanceof Error ? `: ${lastError.message}` : ""
		}${open ? "" : " Open it first or enable automatic project opening."}`
	);
}
