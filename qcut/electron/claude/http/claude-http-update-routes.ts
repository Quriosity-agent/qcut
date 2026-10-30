/**
 * QCut's own updates: `GET /api/claude/updates`, `POST .../updates/pause`
 * and `.../updates/resume` (N26, 2026-10-30 trailer report: hold updates
 * back while a project is under way).
 *
 * @module electron/claude/http/claude-http-update-routes
 */

import type { ClaudeUpdateStatus } from "../../types/claude-api.js";
import { HttpError, type Router } from "../utils/http-router.js";

export function registerUpdateRoutes(
	router: Router,
	options: {
		getStatus: () => Promise<ClaudeUpdateStatus>;
		setPaused: (paused: boolean) => Promise<ClaudeUpdateStatus>;
	}
): void {
	router.get("/api/claude/updates", () => options.getStatus());

	for (const [action, paused] of [
		["pause", true],
		["resume", false],
	] as const) {
		router.post(`/api/claude/updates/${action}`, async () => {
			const status = await options.getStatus();
			if (!status.available) throw new HttpError(409, status.message ?? "");
			return await options.setPaused(paused);
		});
	}
}
