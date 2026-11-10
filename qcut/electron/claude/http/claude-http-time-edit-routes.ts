/**
 * Edits of the timeline's time that the editor makes in one undo step:
 *
 * - `POST /api/claude/timeline/:projectId/gap` opens empty time
 *   (`editor editing insert-gap`), the reverse of a ripple delete of a range;
 * - `POST /api/claude/timeline/:projectId/snap-to-frames` puts clip edges on
 *   whole frames (`editor timeline snap --to frames`).
 *
 * @module electron/claude/http/claude-http-time-edit-routes
 */

import type {
	ClaudeInsertGapResponse,
	ClaudeSnapToFramesResponse,
} from "../../types/claude-api.js";
import { HttpError, type Router } from "../utils/http-router.js";
import { getRequestCorrelationId } from "./claude-http-meta-routes.js";
import { assertProjectIsOpen } from "./claude-http-project-scope.js";
import type { WindowAccessor } from "./claude-http-shared-routes.js";

type TimeEditAccessor = Pick<
	WindowAccessor,
	"requestTimeEdit" | "requestStateSnapshot"
>;

/** A list of ids, or undefined when the request names none. */
function readOptionalIds({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		!Array.isArray(value) ||
		value.some((id) => typeof id !== "string" || !id.trim())
	) {
		throw new HttpError(400, `${field} must be a list of ids`);
	}
	const ids = value.map((id: string) => id.trim());
	return ids.length > 0 ? ids : undefined;
}

function requireEditor(accessor: TimeEditAccessor) {
	if (!accessor.requestTimeEdit) {
		throw new HttpError(503, "This edit is not available in this editor");
	}
	return accessor.requestTimeEdit;
}

export function registerTimeEditRoutes(
	router: Router,
	accessor: TimeEditAccessor
): void {
	router.post("/api/claude/timeline/:projectId/gap", async (req) => {
		const { time, duration, keepAutomation } = req.body ?? {};
		if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
			throw new HttpError(400, "time must be a number of seconds, 0 or more");
		}
		if (
			typeof duration !== "number" ||
			!Number.isFinite(duration) ||
			duration <= 0
		) {
			throw new HttpError(400, "duration must be a number of seconds above 0");
		}
		if (keepAutomation !== undefined && typeof keepAutomation !== "boolean") {
			throw new HttpError(400, "keepAutomation must be true or false");
		}
		const trackIds = readOptionalIds({
			value: req.body?.trackIds,
			field: "trackIds",
		});
		const requestTimeEdit = requireEditor(accessor);
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		return (await requestTimeEdit(
			{
				operation: "insert-gap",
				projectId: req.params.projectId,
				time,
				duration,
				...(trackIds ? { trackIds } : {}),
				...(keepAutomation ? { keepAutomation: true } : {}),
			},
			getRequestCorrelationId({ req })
		)) as ClaudeInsertGapResponse;
	});

	router.post("/api/claude/timeline/:projectId/snap-to-frames", async (req) => {
		const frameAlign = req.body?.frameAlign ?? "visual";
		if (frameAlign !== "visual" && frameAlign !== "all") {
			throw new HttpError(400, "frameAlign must be visual or all");
		}
		const trackIds = readOptionalIds({
			value: req.body?.trackIds,
			field: "trackIds",
		});
		const elementIds = readOptionalIds({
			value: req.body?.elementIds,
			field: "elementIds",
		});
		const requestTimeEdit = requireEditor(accessor);
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		return (await requestTimeEdit(
			{
				operation: "snap-to-frames",
				projectId: req.params.projectId,
				...(trackIds ? { trackIds } : {}),
				...(elementIds ? { elementIds } : {}),
				frameAlign,
				...(req.body?.dryRun === true ? { dryRun: true } : {}),
			},
			getRequestCorrelationId({ req })
		)) as ClaudeSnapToFramesResponse;
	});
}
