/**
 * libass's sizing for the faces an ASS layer will name.
 *
 * libass sizes a face so that its Windows ascent + descent equals the ASS
 * Fontsize, while the editor sizes by the em square. The two agree only for a
 * font whose Windows height is exactly one em, so an uncorrected Fontsize
 * renders about 15 % small for Helvetica (N31). The native export reads the
 * font's OS/2 and head tables in the main process; the export dialog builds
 * its ASS in the renderer, which cannot open font files, so it asks over IPC
 * and keeps the answers in a lookup the ASS builders can read synchronously.
 *
 * @module lib/text/ass-font-metrics
 */
import type { AssFaceMetrics, AssFontMetricsLookup } from "@qcut/editor-core";
import { debugError } from "@/lib/debug/debug-config";

interface FaceRequest {
	family: string;
	bold: boolean;
	italic: boolean;
}

function keyFor({ family, bold, italic }: FaceRequest): string {
	return `${family.trim().toLowerCase()}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
}

/**
 * A lookup that measures nothing — what the dialog path did before N31. For
 * tests, and for a run with no main process to ask.
 */
export const uncorrectedAssFontMetrics: AssFontMetricsLookup = () => undefined;

/** Every weight and slant of each family, for one prefetch. */
export function assFaceRequestsFor(families: Iterable<string>): FaceRequest[] {
	const names = new Set<string>();
	for (const family of families) {
		const trimmed = family?.trim();
		if (trimmed) names.add(trimmed);
	}
	const requests: FaceRequest[] = [];
	for (const family of names) {
		for (const bold of [false, true]) {
			for (const italic of [false, true]) {
				requests.push({ family, bold, italic });
			}
		}
	}
	return requests;
}

/** What one prefetch learned about the faces an ASS layer may name. */
export interface AssFontFacts {
	/** What libass will do with a face; undefined means unmeasured. */
	fontMetrics: AssFontMetricsLookup;
	/** Whether an installed family really carries CJK glyphs. */
	familyCoversCjk: (family: string) => boolean;
}

/** Ask the main process what libass will do with each face. */
export async function loadAssFontMetrics(
	requests: FaceRequest[]
): Promise<AssFontFacts> {
	const wanted = new Map<string, FaceRequest>();
	for (const request of requests) {
		if (request.family?.trim()) wanted.set(keyFor(request), request);
	}

	const measured = new Map<string, AssFaceMetrics>();
	const cjkFamilies = new Set<string>();
	const ffmpeg = window.electronAPI?.ffmpeg;
	if (ffmpeg?.assFontMetrics && wanted.size > 0) {
		try {
			for (const reply of await ffmpeg.assFontMetrics([...wanted.values()])) {
				measured.set(keyFor(reply), {
					sizeFactor: reply.sizeFactor,
					lineHeightEm: reply.lineHeightEm,
				});
				if (reply.coversCjk) cjkFamilies.add(reply.family.trim().toLowerCase());
			}
		} catch (error) {
			// An export must not fail because a font could not be measured: an
			// uncorrected size is the old behaviour, not a broken one.
			debugError("[AssFontMetrics] Could not read font metrics", error);
		}
	}

	return {
		// A face that could not be measured answers undefined, so the generator
		// leaves both its size and its placement alone: a synthetic 1.0 would
		// keep the nominal size while still shifting the caption by the leading.
		fontMetrics: (request) => measured.get(keyFor(request)),
		familyCoversCjk: (family) => cjkFamilies.has(family.trim().toLowerCase()),
	};
}
