/**
 * Reads a clip or track colour from an editor API request body, so every
 * route refuses an unknown colour the same way and with the valid list.
 *
 * @module electron/claude/http/timeline-color-request
 */

import {
	CLAUDE_TIMELINE_COLOR_LABELS,
	isClaudeTimelineColorLabel,
} from "../../types/claude-api.js";
import { HttpError } from "../utils/http-router.js";

/**
 * A colour label, null to clear one ("none" or "" also clear), or undefined
 * when the field is absent.
 */
export function readColorLabelField({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === "" || value === "none") return null;
	if (isClaudeTimelineColorLabel(value)) return value;
	throw new HttpError(
		400,
		`${field} must be one of: ${CLAUDE_TIMELINE_COLOR_LABELS.join(", ")} (or none to clear)`
	);
}
