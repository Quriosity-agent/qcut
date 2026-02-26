/**
 * Claude HTTP State Routes
 *
 * Exposes canonical editor state snapshots over the Claude HTTP API.
 */

import type { Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";
import type {
	EditorStateRequest,
	EditorStateSnapshot,
	StateSection as StateSectionType,
} from "../../types/claude-api.js";
import { StateSection } from "../../types/claude-api.js";

const STATE_SECTION_QUERY_MAP: Record<string, StateSectionType> = {
	timeline: StateSection.TIMELINE,
	selection: StateSection.SELECTION,
	playhead: StateSection.PLAYHEAD,
	media: StateSection.MEDIA,
	editor: StateSection.EDITOR,
	ui: StateSection.UI,
	project: StateSection.PROJECT,
};

export function parseStateRequestFromQuery({
	include,
}: {
	include?: string;
}): EditorStateRequest | undefined {
	try {
		if (!include) return;

		const parts = include
			.split(",")
			.map((part) => part.trim().toLowerCase())
			.filter(Boolean);

		if (parts.length === 0) return;

		const parsed: StateSectionType[] = [];
		for (const part of parts) {
			const section = STATE_SECTION_QUERY_MAP[part];
			if (!section) {
				throw new HttpError(
					400,
					`Invalid include section '${part}'. Valid values: ${Object.keys(STATE_SECTION_QUERY_MAP).join(", ")}`
				);
			}
			if (!parsed.includes(section)) {
				parsed.push(section);
			}
		}

		return { include: parsed };
	} catch (error) {
		if (error instanceof HttpError) {
			throw error;
		}
		throw new HttpError(400, "Invalid include query");
	}
}

export function registerStateRoutes(
	router: Router,
	options: {
		requestSnapshot: (
			request?: EditorStateRequest
		) => Promise<EditorStateSnapshot>;
		timeoutMs?: number;
	}
): void {
	router.get("/api/claude/state", async (req) => {
		try {
			const request = parseStateRequestFromQuery({
				include: req.query.include,
			});
			const timeoutMs = options.timeoutMs ?? 5000;

			return await Promise.race([
				options.requestSnapshot(request),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						timeoutMs
					)
				),
			]);
		} catch (error) {
			if (error instanceof HttpError) {
				throw error;
			}
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to capture editor state"
			);
		}
	});
}
