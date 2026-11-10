/**
 * How the native export reads a source's colour, and the one description it
 * writes every picture in.
 *
 * Clips used to keep whatever their file said: a BT.601 clip stayed BT.601,
 * a full-range one full range, an untagged one untagged, and a PNG became
 * BT.601 with no tags at all. Joined into one stream they sat under the
 * first clip's tags, so a player showed every other kind in the wrong
 * colours (up to 40 levels off on a saturated bar), and a pass that
 * converted the picture read all of it by its first frame.
 *
 * Every picture is now written BT.709, limited range, and says so, which
 * is what the in-browser export writes. A source is read as the preview
 * reads it: by its own tags, and where it has none, as BT.601 below 720
 * lines and BT.709 from there up (Chromium's rule), limited range. The
 * conversion is of the matrix and the range, as the browser's is; the
 * primaries and the transfer are relabelled.
 *
 * An HDR source (PQ or HLG) is left as it was, tags and all: bringing it
 * to BT.709 needs tone mapping, which this is not.
 *
 * @module electron/claude/handlers/claude-export-handler/source-color
 */

import { spawn } from "node:child_process";
import { getFFprobePath } from "../../../ffmpeg/paths.js";

/** What a file's first video stream says of its colour, in ffprobe's words. */
export interface SourceColorProbe {
	pixelFormat?: string;
	space?: string;
	range?: string;
	primaries?: string;
	transfer?: string;
	height?: number;
}

/** How an export reads one source. */
export interface SourceColor {
	/**
	 * A filter that states what an untagged picture is taken to be; it
	 * changes no pixel. Null when the file says it all, or has no matrix.
	 */
	declare: string | null;
	/** An HDR picture, passed on as it is. */
	hdr: boolean;
}

const UNSTATED = new Set(["", "unknown", "unspecified", "reserved"]);
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
/** Pictures with fewer lines than this are read as BT.601 when they do not say. */
const HD_LINES = 720;
/** Pixel formats with no YCbCr matrix or range to state. */
const NO_MATRIX =
	/^(rgb|bgr|gbr|argb|abgr|0rgb|0bgr|x2rgb|x2bgr|pal8|gray|ya|mono)/;

function stated(value: string | undefined): string | undefined {
	return value !== undefined && !UNSTATED.has(value) ? value : undefined;
}

/**
 * How a source with these tags is read. Without a probe (the file could
 * not be read) nothing is assumed, and FFmpeg reads it by its own rules.
 */
export function resolveSourceColor({
	probe,
}: {
	probe: SourceColorProbe | undefined;
}): SourceColor {
	if (!probe?.pixelFormat) return { declare: null, hdr: false };
	const transfer = stated(probe.transfer);
	if (transfer && HDR_TRANSFERS.has(transfer)) {
		return { declare: null, hdr: true };
	}
	if (NO_MATRIX.test(probe.pixelFormat)) return { declare: null, hdr: false };
	const assumed: string[] = [];
	if (!stated(probe.space)) {
		const sd = probe.height !== undefined && probe.height < HD_LINES;
		assumed.push(`colorspace=${sd ? "smpte170m" : "bt709"}`);
	}
	if (!stated(probe.range)) assumed.push("range=tv");
	return {
		declare: assumed.length > 0 ? `setparams=${assumed.join(":")}` : null,
		hdr: false,
	};
}

const EXPORT_TAGS =
	"colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv";

/** States the export's description on a picture that is already in it (black). */
export const EXPORT_PICTURE_TAGS_FILTER = `setparams=${EXPORT_TAGS}`;

/**
 * Brings a picture to the export's description, whatever it arrives as: an
 * RGB still, another matrix, full range. A picture already in it passes
 * through untouched. The rounding is exact, with chroma at full resolution
 * for the conversion: the defaults are a level off on saturated colours.
 */
export const EXPORT_PICTURE_COLOR_FILTERS: readonly string[] = [
	"scale=out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int",
	"format=yuv420p",
	EXPORT_PICTURE_TAGS_FILTER,
];

/** The same description for the encoder, so the file's own tags say it too. */
export const EXPORT_PICTURE_COLOR_ARGS: readonly string[] = [
	"-colorspace",
	"bt709",
	"-color_primaries",
	"bt709",
	"-color_trc",
	"bt709",
	"-color_range",
	"tv",
];

/**
 * A warning when a finished export does not say it is in the export's
 * description: a pass after the clips were encoded lost or changed it, and
 * a player may show the whole picture in shifted colours. Nothing when the
 * file cannot be read.
 */
export function exportColorWarnings({
	probe,
}: {
	probe: SourceColorProbe | undefined;
}): string[] {
	if (!probe) return [];
	const found = [probe.range, probe.space, probe.primaries, probe.transfer].map(
		(value) => stated(value) ?? "unknown"
	);
	const expected = ["tv", "bt709", "bt709", "bt709"];
	if (found.every((value, index) => value === expected[index])) return [];
	return [
		`The exported picture is tagged ${found.join(", ")} (range, matrix, primaries, transfer); it should be ${expected.join(", ")}. A pass after the clips were encoded lost or changed the colour description, and a player may show the picture's colours shifted.`,
	];
}

/** Reads a file's colour tags; undefined when it cannot be read. */
export async function probeSourceColor({
	mediaPath,
}: {
	mediaPath: string;
}): Promise<SourceColorProbe | undefined> {
	let ffprobePath: string;
	try {
		ffprobePath = await getFFprobePath();
	} catch {
		return undefined;
	}
	return new Promise((resolve) => {
		const ffprobe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=pix_fmt,color_space,color_range,color_primaries,color_transfer,height",
				"-of",
				"json",
				mediaPath,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
		);
		let stdout = "";
		const timeoutId = setTimeout(() => {
			ffprobe.kill();
			resolve(undefined);
		}, 10_000);
		ffprobe.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		ffprobe.on("error", () => {
			clearTimeout(timeoutId);
			resolve(undefined);
		});
		ffprobe.on("close", () => {
			clearTimeout(timeoutId);
			try {
				const stream = (
					JSON.parse(stdout) as {
						streams?: Array<{
							pix_fmt?: string;
							color_space?: string;
							color_range?: string;
							color_primaries?: string;
							color_transfer?: string;
							height?: number;
						}>;
					}
				).streams?.[0];
				resolve(
					stream
						? {
								pixelFormat: stream.pix_fmt,
								space: stream.color_space,
								range: stream.color_range,
								primaries: stream.color_primaries,
								transfer: stream.color_transfer,
								height:
									typeof stream.height === "number" ? stream.height : undefined,
							}
						: undefined
				);
			} catch {
				resolve(undefined);
			}
		});
	});
}

/**
 * Remembers, per file, how it is read, so a project that cuts one source
 * into many clips probes it once.
 */
export function createSourceColorReader({
	probe = probeSourceColor,
}: {
	probe?: typeof probeSourceColor;
} = {}) {
	const known = new Map<string, Promise<SourceColor>>();
	return ({ mediaPath }: { mediaPath: string }): Promise<SourceColor> => {
		let result = known.get(mediaPath);
		if (!result) {
			result = probe({ mediaPath }).then((found) =>
				resolveSourceColor({ probe: found })
			);
			known.set(mediaPath, result);
		}
		return result;
	};
}
