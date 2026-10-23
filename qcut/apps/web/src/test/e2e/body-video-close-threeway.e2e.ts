/**
 * Single-person dynamic body closure, part 1: the same 180 timeline frames graded
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
import { installBodyWorkerObserver } from "./helpers/body-video-worker-observer";
import {
	COREML_BODY_PROFILE,
	requestedBodyVideoProfile,
	selectCoreMLBodyProfile,
	captureCoreMLBodyExecutionEvidence,
	verifyEveryBodyPreviewFrame,
} from "./helpers/body-video-profile-evidence";

const bodyProfile = requestedBodyVideoProfile();
const coreml = bodyProfile === COREML_BODY_PROFILE;
const output = path.resolve(
	process.env.QCUT_BODY_CLOSE_OUTPUT ??
		"output/playwright/body-video-close-threeway"
);

const requestedPasses = process.env.QCUT_BODY_CLOSE_PASSES?.split(",")
	.map((pass) => pass.trim())
	.filter(Boolean);
const unknownPasses = (requestedPasses ?? []).filter(
	(pass) => !(BODY_CLOSE_PASSES as string[]).includes(pass)
);
// A typo must not fall back to running every pass (an hour of exports).
if (unknownPasses.length > 0)
	throw new Error(
		`Unknown QCUT_BODY_CLOSE_PASSES: ${unknownPasses.join(",")} (expected ${BODY_CLOSE_PASSES.join("|")})`
	);
const configuredPasses = requestedPasses as PortraitCompositePass[] | undefined;
const scenario = createBodyVideoCloseScenario({
	seconds: Number(process.env.QCUT_BODY_CLOSE_SECONDS ?? 6),
	sampleCount: Number(process.env.QCUT_BODY_CLOSE_SAMPLES ?? 16),
	...(configuredPasses?.length ? { passes: configuredPasses } : {}),
});
if (coreml) scenario.settings.captureEveryFrame = true;
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
		output,
		kind: "body-video-close-threeway",
		requirePortraitSource: true,
		prepareProject: createSingleClipBodyProjectPreparer({
			requireIndependentBodyVideo: scenario.passes.some(
				({ id }) => id === "independent"
			),
			requireNative: scenario.passes.some(({ id }) => id === "native"),
		}),
		...(coreml
			? {
					setupEvidence: async ({ app }) =>
						installBodyWorkerObserver({
							app,
							output: path.join(output, "worker-reports"),
						}),
					afterPass: async ({ app, page, pass, frames }) => {
						if (pass === "original")
							return { profile: "original", preEncodeFrames: frames.length };
						if (pass === "native")
							return {
								profile: "native",
								previewScope: "distributed-samples",
								sampledFrames: scenario.settings.samples,
							};
						const execution =
							pass === "independent"
								? await captureCoreMLBodyExecutionEvidence({
										app,
										output: path.join(output, "independent", "execution"),
										frames: scenario.settings.totalFrames,
									})
								: undefined;
						const previews =
							process.env.QCUT_BODY_CLOSE_ALL_PREVIEWS === "0"
								? {
										previewScope: "distributed-samples",
										sampledFrames: scenario.settings.samples,
									}
								: await verifyEveryBodyPreviewFrame({
										page,
										output,
										pass,
										frames,
										fps: scenario.settings.fps,
									});
						return {
							profile: pass === "independent" ? bodyProfile : "native",
							previews,
							...(execution
								? {
										cpuPasses: execution.cpuPasses,
										coremlPasses: execution.coremlPasses,
									}
								: {}),
						};
					},
				}
			: {}),
		beforeExport: async ({ page, pass }) => {
			if (coreml && pass === "independent")
				await selectCoreMLBodyProfile({
					page,
					output: path.join(output, "independent", "coreml-ui-selection.png"),
				});
			if (parkSeconds > 0) {
				// The untouched pass has no composition surface to wait on.
				if (pass === "original") return;
				await seek({ page, frame: parkFrame, fps: scenario.settings.fps });
				await waitForPausedFrame({
					page,
					frame: parkFrame,
					timeout: 300_000,
				});
			}
		},
	});
});
