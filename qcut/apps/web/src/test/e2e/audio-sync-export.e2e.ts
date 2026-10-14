/**
 * Real exports of a flash + beep fixture, judged by the exported file's own
 * audio/video timing.
 *
 * Every marker second the fixture starts a white flash and a 1 kHz burst
 * together, so in a correct export the audio onset lands on the white
 * frame's PTS. The muxer path used to start audio 56 ms late: 44 ms of AAC
 * encoder priming the MP4 did not declare, plus 12 ms of compressor/limiter
 * lookahead in the export mix. The CLI path is measured as the reference.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
	type AudioSyncMeasurement,
	generateSyncMarkerClip,
	measureAudioSync,
} from "./helpers/audio-sync-evidence";
import { uploadTestMedia } from "./helpers/e2e-panel-helpers";
import { createTestProject, expect } from "./helpers/electron-helpers";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const SOURCE_SECONDS = 4;
// Onset detection resolves to about two samples; 2 ms leaves room for
// encoder pre-echo while still failing any real sync error.
const MAX_SYNC_ERROR_MS = 2;
// The edit list only trims the head. The encoder's flush still pads the
// tail to a frame boundary and adds one more frame (1472 frames for the
// 4 s fixture), always under two 1024-frame AAC frames of silence.
const MAX_AUDIO_OVERHANG_SECONDS = 2048 / 48_000;
const EVIDENCE_DIR = path.resolve(
	process.cwd(),
	"output/playwright/audio-sync"
);

type ExportEngine = "cli" | "muxer";

interface ExposedWindow extends Window {
	__exportActions?: {
		exportLocalVideo: (request: {
			engine: ExportEngine;
			filename: string;
			format: "mp4";
			frameRate: 30;
			height: number;
			outputPath: string;
			projectId: string;
			quality: "720p";
			width: number;
		}) => Promise<void>;
	};
	__mediaStore: {
		getState: () => {
			mediaItems: Array<{ id: string; localPath?: string; name: string }>;
		};
	};
	__projectStore: {
		getState: () => { activeProject: { id: string } | null };
	};
	__timelineStore: {
		getState: () => {
			tracks: Array<{ id: string; isMain?: boolean; type: string }>;
			addElementToTrack: (
				trackId: string,
				element: {
					duration: number;
					mediaId: string;
					name: string;
					startTime: number;
					trimEnd: number;
					trimStart: number;
					type: "media";
				}
			) => string | null;
		};
	};
}

async function placeClip({
	page,
	name,
}: {
	page: Page;
	name: string;
}): Promise<string> {
	return page.evaluate(
		({ name, seconds }) => {
			const editorWindow = window as unknown as ExposedWindow;
			const projectId =
				editorWindow.__projectStore.getState().activeProject?.id;
			if (!projectId) throw new Error("No active project");
			const item = editorWindow.__mediaStore
				.getState()
				.mediaItems.find((candidate) => candidate.name === name);
			if (!item) throw new Error(`Media ${name} was not imported`);
			const timeline = editorWindow.__timelineStore.getState();
			const track = timeline.tracks.find(
				(candidate) => candidate.isMain || candidate.type === "media"
			);
			if (!track) throw new Error("Missing media track");
			const id = timeline.addElementToTrack(track.id, {
				type: "media",
				mediaId: item.id,
				name: item.name,
				duration: seconds,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
			});
			if (!id) throw new Error(`Could not place ${name}`);
			return projectId;
		},
		{ name, seconds: SOURCE_SECONDS }
	);
}

async function waitForLocalPaths({ page }: { page: Page }): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					(window as unknown as ExposedWindow).__mediaStore
						.getState()
						.mediaItems.every((item) => Boolean(item.localPath))
				),
			{ timeout: 30_000 }
		)
		.toBe(true);
}

async function exportWith({
	page,
	engine,
	projectId,
	outputPath,
}: {
	page: Page;
	engine: ExportEngine;
	projectId: string;
	outputPath: string;
}): Promise<void> {
	await page.evaluate(
		async ({ engine, filename, projectId, outputPath, width, height }) => {
			const actions = (window as unknown as ExposedWindow).__exportActions;
			if (!actions) throw new Error("Export actions are not registered");
			await actions.exportLocalVideo({
				engine,
				filename,
				format: "mp4",
				frameRate: 30,
				height,
				outputPath,
				projectId,
				quality: "720p",
				width,
			});
		},
		{
			engine,
			filename: path.basename(outputPath),
			projectId,
			outputPath,
			width: WIDTH,
			height: HEIGHT,
		}
	);
}

function expectInSync({
	label,
	measurement,
}: {
	label: string;
	measurement: AudioSyncMeasurement;
}): void {
	for (const offsetMs of measurement.offsetsMs) {
		expect(Math.abs(offsetMs), `${label} sync error (ms)`).toBeLessThanOrEqual(
			MAX_SYNC_ERROR_MS
		);
	}
	const { audioDurationSeconds, videoDurationSeconds } = measurement.timing;
	const overhang = audioDurationSeconds - videoDurationSeconds;
	expect(overhang, `${label} audio overhang (s)`).toBeGreaterThanOrEqual(
		-0.001
	);
	expect(overhang, `${label} audio overhang (s)`).toBeLessThanOrEqual(
		MAX_AUDIO_OVERHANG_SECONDS
	);
}

test("muxer and CLI exports start audio on the same frame as the picture", async ({
	page,
}) => {
	test.setTimeout(600_000);
	const workDir = await mkdtemp(path.join(tmpdir(), "qcut-audio-sync-"));
	await mkdir(EVIDENCE_DIR, { recursive: true });
	const sourcePath = path.join(workDir, "sync-markers.mp4");
	const outputs = {
		muxer: path.join(workDir, "sync-muxer.mp4"),
		cli: path.join(workDir, "sync-cli.mp4"),
	} satisfies Record<ExportEngine, string>;
	try {
		await generateSyncMarkerClip({
			filePath: sourcePath,
			seconds: SOURCE_SECONDS,
			fps: FPS,
			width: WIDTH,
			height: HEIGHT,
		});
		const fixture = await measureAudioSync({ filePath: sourcePath });

		await page.setViewportSize({ width: 1440, height: 1000 });
		await createTestProject(page, "Audio Sync Export E2E");
		await uploadTestMedia(page, sourcePath);
		await waitForLocalPaths({ page });
		const projectId = await placeClip({
			page,
			name: path.basename(sourcePath),
		});
		await page.getByTestId("export-button").click();
		await expect(page.getByTestId("export-dialog")).toBeVisible();
		await page.waitForFunction(
			() => Boolean((window as unknown as ExposedWindow).__exportActions),
			undefined,
			{ timeout: 10_000 }
		);

		const measurements: Partial<Record<ExportEngine, AudioSyncMeasurement>> =
			{};
		for (const engine of ["muxer", "cli"] as const) {
			await exportWith({
				page,
				engine,
				projectId,
				outputPath: outputs[engine],
			});
			expect(existsSync(outputs[engine])).toBe(true);
			measurements[engine] = await measureAudioSync({
				filePath: outputs[engine],
			});
			await copyFile(
				outputs[engine],
				path.join(EVIDENCE_DIR, path.basename(outputs[engine]))
			);
		}

		// Persist evidence before asserting so failures leave the numbers behind.
		await writeFile(
			path.join(EVIDENCE_DIR, "evidence.json"),
			JSON.stringify({ fixture, ...measurements }, null, 2)
		);

		// The fixture and the measurement must agree with each other first.
		expectInSync({ label: "fixture", measurement: fixture });
		expectInSync({ label: "muxer", measurement: measurements.muxer! });
		expectInSync({ label: "cli", measurement: measurements.cli! });
	} finally {
		await rm(workDir, { force: true, recursive: true });
	}
});
