/**
 * A caption's part of an editor API patch (`update-element`, batch update):
 * its text (`content`, as `timeline export` shows it), language, second-
 * language line (`secondaryContent`) and style, which merges over the
 * caption's current look.
 *
 * @module lib/claude-bridge/claude-caption-patch
 */

import type { CaptionElement } from "@/types/timeline";
import {
	CAPTION_STYLE_KEYS,
	captionStyleFromPatch,
	secondaryCaptionText,
} from "../../../../../electron/types/caption-style-input";

/** The patch fields a caption takes. */
export const CAPTION_PATCH_FIELDS: ReadonlySet<string> = new Set([
	"content",
	"language",
	"secondaryContent",
	"secondaryText",
	"style",
	...CAPTION_STYLE_KEYS,
]);

type CaptionUpdates = Partial<
	Pick<CaptionElement, "text" | "secondaryText" | "language" | "style">
>;

/**
 * The store updates a patch makes to a caption, and the fields it gave that
 * do nothing. A blank `secondaryContent` removes the second line.
 */
export function captionUpdatesFromPatch({
	element,
	changes,
}: {
	element: CaptionElement;
	changes: Record<string, unknown>;
}): { updates: CaptionUpdates; ignoredFields: string[] } {
	const updates: CaptionUpdates = {};
	const ignoredFields: string[] = [];
	if (typeof changes.content === "string") updates.text = changes.content;
	const secondaryText = secondaryCaptionText(changes);
	if (secondaryText !== undefined) {
		updates.secondaryText = secondaryText || undefined;
	}
	for (const key of ["secondaryContent", "secondaryText"]) {
		const value = changes[key];
		if (value !== undefined && value !== null && typeof value !== "string") {
			ignoredFields.push(key);
		}
	}
	if (typeof changes.language === "string") {
		updates.language = changes.language;
	}
	const patch = captionStyleFromPatch({ changes, current: element.style });
	ignoredFields.push(...patch.ignored.map(({ field }) => field));
	if (patch.style) {
		updates.style = patch.style as unknown as CaptionElement["style"];
	}
	return { updates, ignoredFields };
}
