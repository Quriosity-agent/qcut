import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { _electron as electron, type ElectronApplication } from "playwright";

import {
	execute,
	sourceClips,
	verifyTimeline,
	type Session,
	type Timeline,
} from "./editor-real-batch-evidence.ts";
import { runExportPair } from "./editor-real-batch-export.ts";
import { runSidecarVerification } from "./editor-real-batch-sidecar.ts";
const { values } = parseArgs({
	options: {
		"asset-root": { type: "string" },
		"output-dir": { type: "string" },
		phase: { type: "string", default: "prepare" },
	},
});
assert(
	values["asset-root"] && values["output-dir"],
	"Pass --asset-root and --output-dir"
);
const assetRoot = path.resolve(values["asset-root"]);
const outputRoot = path.resolve(values["output-dir"]);
const phase = values.phase;
assert(
	["prepare", "export", "sidecar"].includes(phase),
	"Use --phase prepare, export or sidecar"
);
const sessionFile = path.join(outputRoot, "session.json");
const environment: Record<string, string> = {
	...Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined
		)
	),
	NODE_ENV: "test",
	QCUT_E2E_OFFSCREEN: "1",
	QCUT_API_TOKEN: randomBytes(24).toString("hex"),
	XDG_STATE_HOME: path.join(outputRoot, "state-home"),
};
let app: ElectronApplication | undefined;
let commandIndex = 0;
const runId = Date.now();
const electronLog: string[] = [];

async function save({ name, value }: { name: string; value: unknown }) {
	await writeFile(path.join(outputRoot, name), JSON.stringify(value, null, 2));
}

async function availablePort() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert(address && typeof address !== "string");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
	return address.port;
}

async function cli<T>({ args }: { args: string[] }): Promise<T> {
	const startedAt = Date.now();
	const label =
		`${phase}-${runId}-${String(commandIndex++).padStart(3, "0")}-${args[0]}`.replaceAll(
			":",
			"-"
		);
	try {
		const { stdout, stderr } = await execute(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
			{
				cwd: process.cwd(),
				env: environment,
				maxBuffer: 16 * 1024 * 1024,
				timeout: 900_000,
			}
		);
		await save({
			name: `${label}.json`,
			value: {
				args,
				elapsedMs: Date.now() - startedAt,
				stderr,
				result: JSON.parse(stdout),
			},
		});
		return JSON.parse(stdout) as T;
	} catch (error) {
		const failure = error as Error & { stdout?: string; stderr?: string };
		await save({
			name: `${label}-failed.json`,
			value: {
				args,
				elapsedMs: Date.now() - startedAt,
				error: failure.message,
				stdout: failure.stdout,
				stderr: failure.stderr,
			},
		});
		throw error;
	}
}

async function retryRead<T>({
	read,
	accept,
	timeoutMs = 30_000,
}: {
	read: () => Promise<T>;
	accept: (value: T) => boolean;
	timeoutMs?: number;
}): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	async function attempt(): Promise<T> {
		const value = await read();
		if (accept(value)) return value;
		assert(Date.now() < deadline, "Read-only state wait timed out");
		await new Promise((resolve) => setTimeout(resolve, 250));
		return attempt();
	}
	return attempt();
}

async function launch() {
	environment.QCUT_API_PORT = String(await availablePort());
	app = await electron.launch({
		args: [
			"dist/electron/main.js",
			`--user-data-dir=${path.join(outputRoot, "profile")}`,
		],
		env: environment,
		timeout: 60_000,
	});
	for (const stream of [app.process().stdout, app.process().stderr]) {
		stream?.on("data", (chunk: Buffer) => {
			electronLog.push(chunk.toString());
			void appendFile(
				path.join(outputRoot, `${phase}-${runId}-electron.log`),
				chunk
			).catch(() => {});
		});
	}
	const page = await app.firstWindow();
	await app.evaluate(({ BrowserWindow }) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.setBackgroundThrottling(false);
			window.setOpacity(1);
			window.setIgnoreMouseEvents(false);
			window.showInactive();
		}
	});
	page.on("pageerror", (error) => {
		void appendFile(
			path.join(outputRoot, `${phase}-renderer-errors.log`),
			`${error.stack}\n`
		).catch(() => {});
	});
	await page.waitForLoadState("domcontentloaded");
	await page.waitForFunction(() =>
		Boolean(document.getElementById("root")?.children.length)
	);
	await page.evaluate(() => localStorage.setItem("hasSeenOnboarding", "true"));
	await cli({ args: ["editor:health"] });
	return page;
}

async function prepare() {
	let session: Session | undefined;
	try {
		session = JSON.parse(await readFile(sessionFile, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (session) {
		assert(
			session.clips.every((clip) => path.dirname(clip.file) === assetRoot),
			"Existing session belongs to the requested asset root"
		);
	}
	const page = await launch();
	if (!session) {
		const clips = await sourceClips({ assetRoot });
		const created = await cli<{ projectId: string }>({
			args: [
				"editor:project:create",
				"--name",
				`Real 32 clip regression ${new Date().toISOString()}`,
				"--width",
				"1470",
				"--height",
				"630",
				"--fps",
				"24",
				"--open",
			],
		});
		assert(created.projectId, "Create returned a project ID");
		session = { projectId: created.projectId, clips };
		await save({ name: "session.json", value: session });
	}
	const { projectId, clips } = session;
	await cli({ args: ["editor:navigator:open", "--project-id", projectId] });
	await cli({ args: ["editor:ui:switch-panel", "--panel", "video-edit"] });
	const before = await cli<Timeline>({
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	if (before.tracks.flatMap((track) => track.elements).length === 0) {
		const media = await cli<Array<{ name: string }>>({
			args: ["editor:media:list", "--project-id", projectId],
		});
		const missing = clips.filter(
			(clip) => !media.some((item) => item.name === clip.name)
		);
		await missing.reduce(async (previous, _, index) => {
			await previous;
			if (index % 20 !== 0) return;
			await cli({
				args: [
					"editor:media:batch-import",
					"--project-id",
					projectId,
					"--items",
					JSON.stringify(
						missing
							.slice(index, index + 20)
							.map((clip) => ({ path: clip.file }))
					),
				],
			});
		}, Promise.resolve());
		const mainTrack =
			before.tracks.find((track) => track.isMain) ?? before.tracks[0];
		assert(mainTrack, "Main track exists");
		const batchStarted = Date.now();
		const added = await cli<{ addedCount: number; failedCount: number }>({
			args: [
				"editor:timeline:batch-add",
				"--project-id",
				projectId,
				"--elements",
				JSON.stringify(
					clips.map((clip) => ({
						type: "media",
						sourceName: clip.name,
						trackId: mainTrack.id,
						startTime: "end",
					}))
				),
			],
		});
		assert.equal(added.failedCount, 0);
		await save({
			name: "batch-result.json",
			value: {
				added,
				elapsedMs: Date.now() - batchStarted,
				cliTimeoutOverride: false,
			},
		});
	}
	const timeline = await cli<Timeline>({
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	session.timelineDuration = verifyTimeline({ timeline, clips });
	await save({ name: "session.json", value: session });
	await save({ name: "timeline-before-reopen.json", value: timeline });
	await cli({
		args: [
			"editor:mix:master-set",
			"--project-id",
			projectId,
			"--gain-db",
			"12",
			"--effects",
			JSON.stringify({
				limiter: { enabled: true, ceilingDb: -1, releaseMs: 50 },
			}),
		],
	});
	await cli({
		args: ["editor:timeline:seek", "--project-id", projectId, "--time", "0.5"],
	});
	await page.screenshot({ path: path.join(outputRoot, "timeline-start.png") });
	const preview = page.getByTestId("preview-capture-surface");
	const beforeFrame = await preview.screenshot({
		path: path.join(outputRoot, "preview-before-play.png"),
	});
	await page.evaluate(() => {
		const receipt = { ticks: 0, lastTime: 0 };
		Reflect.set(window, "__batchPlaybackReceipt", receipt);
		window.addEventListener("playback-update", (event) => {
			receipt.ticks += 1;
			receipt.lastTime = (event as CustomEvent<{ time: number }>).detail.time;
		});
	});
	await cli({ args: ["editor:timeline:play", "--project-id", projectId] });
	await page.waitForFunction(
		() =>
			(Reflect.get(window, "__batchPlaybackReceipt") as { lastTime: number })
				.lastTime > 1.5
	);
	await cli({ args: ["editor:timeline:pause", "--project-id", projectId] });
	const paused = await cli<{
		state: { timeline: { playhead: { currentTime: number } } };
	}>({ args: ["editor:state:snapshot", "--include", "timeline"] });
	assert(paused.state.timeline.playhead.currentTime > 1.5);
	const afterFrame = await preview.screenshot({
		path: path.join(outputRoot, "preview-after-play.png"),
	});
	assert(
		!beforeFrame.equals(afterFrame),
		"Preview image advanced during playback"
	);
	const clock = await page.evaluate(() =>
		Reflect.get(window, "__batchPlaybackReceipt")
	);
	await save({
		name: "playback.json",
		value: {
			paused,
			clock,
			previewImageChanged: true,
			window: { showInactive: true, backgroundThrottling: false },
		},
	});
	await page.screenshot({
		path: path.join(outputRoot, "timeline-playback.png"),
	});
	await cli({
		args: [
			"editor:timeline:seek",
			"--project-id",
			projectId,
			"--time",
			String(session.timelineDuration * 0.7),
		],
	});
	await page.screenshot({ path: path.join(outputRoot, "timeline-scrub.png") });
	await page.evaluate(async () => {
		const stores = window as unknown as {
			__projectStore: {
				getState: () => { saveCurrentProject: () => Promise<void> };
			};
			__timelineStore: {
				getState: () => { saveImmediate: () => Promise<void> };
			};
		};
		await stores.__projectStore.getState().saveCurrentProject();
		await stores.__timelineStore.getState().saveImmediate();
	});
	await retryRead<{
		state: {
			timeline: { autoSave: { isSaving: boolean; lastSavedAt: number } };
		};
	}>({
		read: () =>
			cli({ args: ["editor:state:snapshot", "--include", "timeline"] }),
		accept: (snapshot) =>
			!snapshot.state.timeline.autoSave.isSaving &&
			snapshot.state.timeline.autoSave.lastSavedAt > 0,
	});
	await app?.close();
	app = undefined;
	const reopened = await launch();
	await cli({ args: ["editor:navigator:open", "--project-id", projectId] });
	await cli({ args: ["editor:ui:switch-panel", "--panel", "video-edit"] });
	const persisted = await cli<Timeline>({
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	assert.equal(
		verifyTimeline({ timeline: persisted, clips }),
		session.timelineDuration
	);
	assert.deepEqual(
		persisted.tracks.flatMap((track) =>
			track.elements.map((element) => element.id)
		),
		timeline.tracks.flatMap((track) =>
			track.elements.map((element) => element.id)
		)
	);
	await save({ name: "timeline-after-reopen.json", value: persisted });
	await reopened.screenshot({
		path: path.join(outputRoot, "timeline-reopened.png"),
	});
	await save({
		name: "prepare-result.json",
		value: {
			status: "passed",
			projectId,
			count: 32,
			timelineDuration: session.timelineDuration,
			playback: true,
			reopen: true,
			defaultBatchTimeout: true,
		},
	});
	console.log(
		JSON.stringify({ phase, status: "passed", projectId, outputRoot })
	);
}

async function exportProject() {
	const session: Session = JSON.parse(await readFile(sessionFile, "utf8"));
	const page = await launch();
	await cli({
		args: ["editor:navigator:open", "--project-id", session.projectId],
	});
	await cli({ args: ["editor:ui:switch-panel", "--panel", "video-edit"] });
	const result = await runExportPair({ session, outputRoot, cli });
	await page.screenshot({ path: path.join(outputRoot, "export-complete.png") });
	console.log(JSON.stringify({ phase, status: "passed", outputRoot, result }));
}

async function verifySidecar() {
	const session: Session = JSON.parse(await readFile(sessionFile, "utf8"));
	assert(session.clips.every((clip) => path.dirname(clip.file) === assetRoot));
	let page = await launch();
	await cli({
		args: ["editor:navigator:open", "--project-id", session.projectId],
	});
	assert(app);
	const documents = await app.evaluate(({ app }) => app.getPath("documents"));
	const result = await runSidecarVerification({
		session,
		outputRoot,
		sidecarPath: path.join(
			documents,
			"QCut",
			"Projects",
			session.projectId,
			"project.json"
		),
		cli,
		saveProject: () =>
			page.evaluate(async () => {
				const stores = window as unknown as {
					__projectStore: {
						getState: () => { saveCurrentProject: () => Promise<void> };
					};
					__timelineStore: {
						getState: () => { saveImmediate: () => Promise<void> };
					};
				};
				await stores.__projectStore.getState().saveCurrentProject();
				await stores.__timelineStore.getState().saveImmediate();
			}),
		reopen: async () => {
			await app?.close();
			app = undefined;
			page = await launch();
			await cli({
				args: ["editor:navigator:open", "--project-id", session.projectId],
			});
			return page;
		},
		readLog: () => electronLog.join(""),
	});
	console.log(JSON.stringify({ phase, status: "passed", outputRoot, result }));
}

await mkdir(outputRoot, { recursive: true });
try {
	if (phase === "prepare") await prepare();
	else if (phase === "export") await exportProject();
	else await verifySidecar();
} catch (error) {
	await save({
		name: `${phase}-error.json`,
		value: {
			message: String(error),
			stack: error instanceof Error ? error.stack : undefined,
		},
	});
	const screenshotPath = path.join(outputRoot, `${phase}-error.png`);
	if (app)
		await app
			.firstWindow({ timeout: 5000 })
			.then((page) => page.screenshot({ path: screenshotPath, timeout: 5000 }))
			.catch(() => {});
	throw error;
} finally {
	await app?.close().catch((error) => {
		console.error("Failed to close the test Electron instance:", error);
		process.exitCode = 1;
	});
}
