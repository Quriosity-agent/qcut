import path from "node:path";
import { test } from "@playwright/test";
import { createBodyCompositeScenario } from "./helpers/body-composite-scenario";
import { runCompositeConsistency } from "./helpers/portrait-composite-runner";

const configuredSamples = process.env.QCUT_BODY_COMPOSITE_SAMPLES;
const configuredPasses = process.env.QCUT_BODY_COMPOSITE_PASSES;
const scenario = createBodyCompositeScenario({
	seconds: Number(process.env.QCUT_BODY_COMPOSITE_SECONDS ?? 6),
	...(configuredSamples !== undefined
		? { samples: configuredSamples.split(",").map(Number) }
		: {}),
	...(configuredPasses !== undefined
		? { passes: configuredPasses.split(",") }
		: {}),
});

test("real body composite: 1080p moving source, smart and manual preview/export with reverse seeks", async () => {
	await runCompositeConsistency({
		...scenario,
		source: process.env.QCUT_BODY_COMPOSITE_SOURCE,
		output: path.resolve(
			process.env.QCUT_BODY_COMPOSITE_OUTPUT ??
				"output/playwright/body-composite-consistency"
		),
		kind: "body-composite-preview-export",
		requirePortraitSource: true,
	});
});
