/**
 * Project scope for mutating routes.
 *
 * The renderer only ever edits the project it has open, so a request that
 * names another project would silently edit the wrong one. Every route that
 * changes the open project through the renderer checks the id first and
 * answers 409 when it does not match; `claude-http-project-scope-policy.test`
 * keeps the list of routes that must call this honest.
 *
 * @module electron/claude/http/claude-http-project-scope
 */

import { HttpError } from "../utils/http-router.js";
import type { WindowAccessor } from "./claude-http-shared-routes.js";

/** Whatever can report the open project; every server accessor qualifies. */
export type ProjectScopeAccessor = Pick<WindowAccessor, "requestStateSnapshot">;

const PROJECT_SCOPE_TIMEOUT_MS = 5000;

export async function assertProjectIsOpen({
	accessor,
	projectId,
}: {
	accessor: ProjectScopeAccessor;
	projectId: string | undefined;
}): Promise<void> {
	if (!projectId) return;
	const requestStateSnapshot = accessor.requestStateSnapshot;
	if (!requestStateSnapshot) return;
	let openProjectId: string | undefined;
	try {
		const snapshot = await Promise.race([
			requestStateSnapshot({ include: ["project"] }),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("state snapshot timed out")),
					PROJECT_SCOPE_TIMEOUT_MS
				)
			),
		]);
		const project = snapshot.state?.project;
		openProjectId = project?.activeProject?.id;
	} catch {
		throw new HttpError(
			503,
			"No active editor project could be confirmed. Try again after QCut finishes loading."
		);
	}
	if (!openProjectId) {
		throw new HttpError(
			409,
			`The editor has no project open. Open ${projectId} first (editor:navigator:open --project-id ${projectId}) or pass --focus.`
		);
	}
	if (openProjectId === projectId) return;
	throw new HttpError(
		409,
		`The editor has ${openProjectId} open, not ${projectId}. Open it first (editor:navigator:open --project-id ${projectId}) or pass --focus.`
	);
}
