/**
 * Single-person dynamic body closure, part 1: the same 180 real frames graded
 * three ways (untouched / native / independent) through the real export, with
 * pre-encode export frames and the committed paused-preview canvas captured at
 * the sampled indices. Analysis lives in scripts/body-video-close-report.py.
 */
import path from "node:path";
import { test } from "@playwright/test";
import {
	BODY_CLOSE_PASSES,
	createBodyVideoCloseScenario,
	createSingleClipBodyProjectPreparer,
} from "./helpers/body-video-close-scenario";
import {
	seek,
	waitForPausedFrame,
} from "./helpers/independent-body-video-helpers";
import type { PortraitCompositePass } from "./helpers/portrait-composite-project";
import { runCompositeConsistency } from "./helpers/portrait-composite-runner";

const configuredPasses = process.env.QCUT_BODY_CLOSE_PASSES?.split(",").filter(
	(pass): pass is PortraitCompositePass =>
		(BODY_CLOSE_PASSES as string[]).includes(pass)
);
const scenario = createBodyVideoCloseScenario({
	seconds: Number(process.env.QCUT_BODY_CLOSE_SECONDS ?? 6),
	sampleCount: Number(process.env.QCUT_BODY_CLOSE_SAMPLES ?? 16),
	...(configuredPasses?.length ? { passes: configuredPasses } : {}),
});
// With the playhead parked here before each graded export, the export's frame 0
// is a timestamp discontinuity for the native tracker: a cold start instead of
// the tracker the paused preview at frame 0 has already warmed.
const parkSeconds = Number(process.env.QCUT_BODY_CLOSE_PARK_SECONDS ?? 0);
const parkFrame = Math.round(parkSeconds * scenario.settings.fps);
if (parkSeconds > 0 && parkFrame >= scenario.settings.totalFrames)
	throw new Error("QCUT_BODY_CLOSE_PARK_SECONDS must fall inside the clip");

test("single-person body closure: untouched, native and independent on one clean 6 s clip", async () => {
	await runCompositeConsistency({
		...scenario,
		source: process.env.QCUT_BODY_CLOSE_SOURCE,
		output: path.resolve(
			process.env.QCUT_BODY_CLOSE_OUTPUT ??
				"output/playwright/body-video-close-threeway"
		),
		kind: "body-video-close-threeway",
		requirePortraitSource: true,
		prepareProject: createSingleClipBodyProjectPreparer({
			requireIndependentBodyVideo: scenario.passes.some(
				({ id }) => id === "independent"
			),
			requireNative: scenario.passes.some(({ id }) => id === "native"),
		}),
		...(parkSeconds > 0
			? {
					beforeExport: async ({ page, pass }) => {
						// The untouched pass has no composition surface to wait on.
						if (pass === "original") return;
						await seek({ page, frame: parkFrame, fps: scenario.settings.fps });
						await waitForPausedFrame({
							page,
							frame: parkFrame,
							timeout: 300_000,
						});
					},
				}
			: {}),
	});
});
