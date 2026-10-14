/**
 * Claude Navigator Bridge
 *
 * Handles project listing and navigation requests from the main process.
 * Enables the CLI to list projects and open the editor view.
 *
 * @module lib/claude-bridge/claude-navigator-bridge
 */

import { useProjectStore } from "@/stores/project-store";
import { platform } from "@qcut/platform-core";

const DEBUG = true;
const PREFIX = "[ClaudeNavigatorBridge]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	console.warn(PREFIX, ...args);
}

function debugError(...args: unknown[]): void {
	console.error(PREFIX, ...args);
}

/** Stays under the main process's navigation timeout so a slow load is reported, not dropped. */
export const PROJECT_OPEN_TIMEOUT_MS = 20_000;

/**
 * Resolves once the editor has really opened `projectId`: its media,
 * timeline and stickers have loaded and the window still shows its editor
 * route. Changing the hash only asks the router to navigate; the editor
 * then loads the project, and a missing project is replaced by a new one.
 */
export function waitForProjectOpen({
	projectId,
	timeoutMs = PROJECT_OPEN_TIMEOUT_MS,
}: {
	projectId: string;
	timeoutMs?: number;
}): Promise<{ navigated: boolean; error?: string }> {
	const editorHash = `#/editor/${projectId}`;
	const onEditorRoute = () =>
		window.location.hash === editorHash ||
		window.location.hash.startsWith(`${editorHash}?`);
	const isOpen = () =>
		onEditorRoute() && useProjectStore.getState().loadedProjectId === projectId;
	return new Promise((resolve) => {
		const finish = (result: { navigated: boolean; error?: string }) => {
			clearTimeout(timer);
			unsubscribe();
			window.removeEventListener("hashchange", onHashChange);
			resolve(result);
		};
		const onHashChange = () => {
			if (!onEditorRoute()) {
				finish({
					navigated: false,
					error: `The editor left project ${projectId} for ${window.location.hash || "#/"}`,
				});
				return;
			}
			if (isOpen()) finish({ navigated: true });
		};
		const unsubscribe = useProjectStore.subscribe(() => {
			if (isOpen()) finish({ navigated: true });
		});
		window.addEventListener("hashchange", onHashChange);
		const timer = setTimeout(
			() =>
				finish({
					navigated: false,
					error: `The editor did not finish opening project ${projectId} within ${timeoutMs / 1000}s`,
				}),
			timeoutMs
		);
		// Already open: the hash assignment that follows will not fire hashchange.
		queueMicrotask(() => {
			if (isOpen()) finish({ navigated: true });
		});
	});
}

/**
 * Register navigation handlers with the Claude Navigator API to respond to project list and open requests.
 *
 * If the platform Claude navigator is unavailable, no handlers are registered. The registered handlers
 * send project lists (including ISO string dates) and the active project id in responses, and navigate
 * the application to the editor view by updating window.location.hash when an open request is handled.
 */
export function setupClaudeNavigatorBridge(): void {
	const navAPI = platform().claude?.navigator;
	if (!navAPI) {
		debugWarn("Claude Navigator API not available");
		return;
	}

	debugLog("Setting up bridge...");

	// Handle project list request
	navAPI.onProjectsRequest(async (data: { requestId: string }) => {
		try {
			debugLog("Received projects list request");
			const projectStore = useProjectStore.getState();

			// Ensure projects are loaded
			if (!projectStore.isInitialized) {
				await projectStore.loadAllProjects();
			}

			const projects = projectStore.savedProjects.map((p) => ({
				id: p.id,
				name: p.name,
				createdAt:
					p.createdAt instanceof Date
						? p.createdAt.toISOString()
						: String(p.createdAt),
				updatedAt:
					p.updatedAt instanceof Date
						? p.updatedAt.toISOString()
						: String(p.updatedAt),
			}));

			const activeProjectId = projectStore.activeProject?.id ?? null;

			navAPI.sendProjectsResponse(data.requestId, {
				projects,
				activeProjectId,
			});
			debugLog("Sent projects response:", projects.length, "projects");
		} catch (error) {
			debugError("Failed to list projects:", error);
			navAPI.sendProjectsResponse(data.requestId, {
				projects: [],
				activeProjectId: null,
			});
		}
	});

	// Handle navigate-to-project request
	navAPI.onOpenRequest(
		async (data: { requestId: string; projectId: string }) => {
			try {
				debugLog("Received navigate request:", data.projectId);

				// Ensure projects are loaded so we can validate
				if (!useProjectStore.getState().isInitialized) {
					await useProjectStore.getState().loadAllProjects();
				}

				const project = useProjectStore
					.getState()
					.savedProjects.find((p) => p.id === data.projectId);

				if (!project) {
					debugWarn("Project not found:", data.projectId);
					navAPI.sendOpenResponse(data.requestId, {
						navigated: false,
						projectId: data.projectId,
						error: `Project ${data.projectId} does not exist`,
					});
					return;
				}

				const opened = waitForProjectOpen({ projectId: data.projectId });
				// Navigate using hash routing (TanStack Router uses createHashHistory)
				window.location.hash = `#/editor/${data.projectId}`;
				const result = await opened;

				navAPI.sendOpenResponse(data.requestId, {
					...result,
					projectId: data.projectId,
				});
				debugLog("Navigation finished:", data.projectId, result);
			} catch (error) {
				debugError("Failed to navigate:", error);
				navAPI.sendOpenResponse(data.requestId, {
					navigated: false,
					projectId: data.projectId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	);

	debugLog("Bridge setup complete");
}

/**
 * Remove any registered Claude navigator event listeners from the platform, if present.
 */
export function cleanupClaudeNavigatorBridge(): void {
	platform().claude?.navigator?.removeListeners?.();
	debugLog("Bridge cleanup complete");
}
