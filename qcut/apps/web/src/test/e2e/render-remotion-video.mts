#!/usr/bin/env npx tsx
/**
 * Renders a real video from the Remotion test fixture using @remotion/renderer.
 * Produces an MP4 file to verify the full Remotion export pipeline.
 *
 * Usage: npx tsx apps/web/src/test/e2e/render-remotion-video.mts
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

const FIXTURE_DIR = resolve(
	process.cwd(),
	"apps/web/src/test/e2e/fixtures/remotion/valid-project"
);
const ENTRY_POINT = resolve(FIXTURE_DIR, "src/index.ts");
const OUTPUT_DIR = resolve(process.cwd(), "output/remotion-e2e-export");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "HelloWorld.mp4");

async function main() {
	console.log("=== Remotion Full Export E2E ===\n");

	// 1. Ensure output directory exists
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// 2. Bundle the Remotion project
	console.log("Step 1/3: Bundling Remotion project...");
	console.log(`  Entry: ${ENTRY_POINT}`);

	const rootNodeModules = resolve(process.cwd(), "node_modules");
	const bundleLocation = await bundle({
		entryPoint: ENTRY_POINT,
		// Resolve all deps from the monorepo root node_modules
		webpackOverride: (config) => ({
			...config,
			resolve: {
				...config.resolve,
				modules: [rootNodeModules, "node_modules"],
			},
			resolveLoader: {
				...config.resolveLoader,
				modules: [rootNodeModules, "node_modules"],
			},
		}),
	});

	console.log(`  Bundle ready: ${bundleLocation}\n`);

	// 3. Select the composition to render
	console.log("Step 2/3: Selecting composition...");
	const composition = await selectComposition({
		serveUrl: bundleLocation,
		id: "HelloWorld",
	});
	console.log(
		`  Composition: ${composition.id} (${composition.durationInFrames} frames @ ${composition.fps}fps, ${composition.width}x${composition.height})\n`
	);

	// 4. Render the video
	console.log("Step 3/3: Rendering video...");
	console.log(`  Output: ${OUTPUT_FILE}`);

	await renderMedia({
		composition,
		serveUrl: bundleLocation,
		codec: "h264",
		outputLocation: OUTPUT_FILE,
		onProgress: ({ progress }) => {
			const pct = Math.round(progress * 100);
			process.stdout.write(`\r  Progress: ${pct}%`);
		},
	});

	console.log(`\r  Progress: 100% — Done!\n`);
	console.log(`=== Export complete ===`);
	console.log(`Video: ${OUTPUT_FILE}`);
}

main().catch((err) => {
	console.error("Export failed:", err);
	process.exit(1);
});
