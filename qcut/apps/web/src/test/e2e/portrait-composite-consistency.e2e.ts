import path from "node:path";
import { test } from "@playwright/test";
import {
	portraitCompositeAdjustments,
	type PortraitCompositePass,
} from "./helpers/portrait-composite-project";
import { runCompositeConsistency } from "./helpers/portrait-composite-runner";

const requestedPasses = (
	process.env.QCUT_PORTRAIT_COMPOSITE_PASSES ?? "original,native,independent"
).split(",");
if (
	requestedPasses.length === 0 ||
	requestedPasses.some(
		(pass) => !["original", "native", "independent"].includes(pass)
	)
) {
	throw new Error("Unknown portrait composite evidence pass");
}
const passes = [...new Set(requestedPasses)] as PortraitCompositePass[];

test("real portrait composite: 1080p preview and pre-encode exports across original, native and independent", async () => {
	await runCompositeConsistency({
		source: process.env.QCUT_PORTRAIT_COMPOSITE_SOURCE,
		output: path.resolve(
			process.env.QCUT_PORTRAIT_COMPOSITE_OUTPUT ??
				"output/playwright/portrait-composite-consistency"
		),
		passes: passes.map((id) => ({
			id,
			adjustments: portraitCompositeAdjustments({ pass: id }),
		})),
		requireAudio: process.env.QCUT_PORTRAIT_COMPOSITE_REQUIRE_AUDIO === "1",
		traceHelperPath: process.env.QCUT_PORTRAIT_COMPOSITE_TRACE_HELPER,
	});
});
