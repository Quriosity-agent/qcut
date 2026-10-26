import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import {
	verifyTimeline,
	type Session,
	type Timeline,
} from "./editor-real-batch-evidence.ts";

interface Snapshot {
	projectId: string;
	name: string;
	settings: {
		width: number;
		height: number;
		fps: number;
		elementCount: number;
		totalDuration: number;
	};
	media: unknown[];
	timeline?: Timeline;
}

async function waitForSnapshot({
	file,
	name,
	modifiedAfter,
}: {
	file: string;
	name: string;
	modifiedAfter: number;
}) {
	const deadline = Date.now() + 30_000;
	async function attempt(): Promise<{
		snapshot: Snapshot;
		modifiedAt: number;
	}> {
		try {
			const snapshot: Snapshot = JSON.parse(await readFile(file, "utf8"));
			const modifiedAt = (await stat(file)).mtimeMs;
			if (snapshot.name === name && modifiedAt > modifiedAfter) {
				return { snapshot, modifiedAt };
			}
		} catch (error) {
			const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
			if (!missing && !(error instanceof SyntaxError)) throw error;
		}
		assert(
			Date.now() < deadline,
			"Fresh project.json did not reflect mutation"
		);
		await new Promise((resolve) => setTimeout(resolve, 250));
		return attempt();
	}
	return attempt();
}

function verifySnapshot({
	snapshot,
	session,
}: {
	snapshot: Snapshot;
	session: Session;
}) {
	assert.equal(snapshot.projectId, session.projectId);
	assert.equal(snapshot.settings.width, 1470);
	assert.equal(snapshot.settings.height, 630);
	assert.equal(snapshot.settings.fps, 24);
	assert.equal(snapshot.settings.elementCount, 32);
	assert.equal(snapshot.media.length, 32);
	assert(
		Math.abs(
			snapshot.settings.totalDuration - (session.timelineDuration ?? 0)
		) < 0.0001
	);
}

export async function runSidecarVerification({
	session,
	outputRoot,
	sidecarPath,
	cli,
	saveProject,
	reopen,
	readLog,
}: {
	session: Session;
	outputRoot: string;
	sidecarPath: string;
	cli: <T>(args: { args: string[] }) => Promise<T>;
	saveProject: () => Promise<void>;
	reopen: () => Promise<Page>;
	readLog: () => string;
}) {
	const projectId = session.projectId;
	const timeline = await cli<Timeline>({
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	verifyTimeline({ timeline, clips: session.clips });
	const settings = await cli<{ name: string }>({
		args: ["editor:project:settings", "--project-id", projectId],
	});
	assert(settings.name);
	const initial = await waitForSnapshot({
		file: sidecarPath,
		name: settings.name,
		modifiedAfter: 0,
	});
	verifySnapshot({ snapshot: initial.snapshot, session });
	const marker = `${settings.name} sidecar-${Date.now()}`;
	const updateName = ({ name }: { name: string }) =>
		cli({
			args: [
				"editor:project:update-settings",
				"--project-id",
				projectId,
				"--data",
				JSON.stringify({ name }),
			],
		});
	let mutation: Awaited<ReturnType<typeof waitForSnapshot>> | undefined;
	try {
		await updateName({ name: marker });
		mutation = await waitForSnapshot({
			file: sidecarPath,
			name: marker,
			modifiedAfter: initial.modifiedAt,
		});
		verifySnapshot({ snapshot: mutation.snapshot, session });
		await writeFile(
			path.join(outputRoot, "sidecar-mutated.json"),
			JSON.stringify(mutation, null, 2)
		);
	} finally {
		await updateName({ name: settings.name });
	}
	const restored = await waitForSnapshot({
		file: sidecarPath,
		name: settings.name,
		modifiedAfter: mutation?.modifiedAt ?? initial.modifiedAt,
	});
	verifySnapshot({ snapshot: restored.snapshot, session });
	await saveProject();
	const beforeReopen = (await stat(sidecarPath)).mtimeMs;
	const reopened = await reopen();
	const persisted = await waitForSnapshot({
		file: sidecarPath,
		name: settings.name,
		modifiedAfter: beforeReopen,
	});
	verifySnapshot({ snapshot: persisted.snapshot, session });
	const after = await cli<Timeline>({
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	assert.deepEqual(
		after,
		timeline,
		"Sidecar mutation and reopen preserve the full timeline"
	);
	const exportedPath = path.join(outputRoot, "sidecar-project-export.json");
	await cli({
		args: [
			"editor:project:export-state",
			"--project-id",
			projectId,
			"--output",
			exportedPath,
		],
	});
	const exported: Snapshot = JSON.parse(await readFile(exportedPath, "utf8"));
	verifySnapshot({ snapshot: exported, session });
	assert.equal(exported.name, settings.name);
	// The timeline CLI adds a mix alias and active-view context to the API payload.
	const apiTimeline = Object.fromEntries(
		Object.entries(timeline).filter(([key]) => key !== "mix" && key !== "view")
	);
	assert.deepEqual(exported.timeline, apiTimeline);
	await reopened.screenshot({
		path: path.join(outputRoot, "sidecar-reopened.png"),
	});
	const logs = readLog();
	assert(!logs.includes("Unauthorized"), "No new internal API auth failures");
	assert(
		logs.includes(`[ProjectJSON] Auto-synced project.json for ${projectId}`),
		"HTTP auto-sync completed"
	);
	assert(
		logs.includes(`[ProjectJSON] Wrote project.json for ${projectId}`),
		"IPC sidecar write completed"
	);
	const result = {
		status: "passed",
		projectId,
		sidecarPath,
		mutation: "project name marker restored after verification",
		modifiedAt: {
			initial: initial.modifiedAt,
			mutated: mutation?.modifiedAt,
			restored: restored.modifiedAt,
			reopened: persisted.modifiedAt,
		},
		timelineDeepEqual: true,
		count: 32,
		httpAutoSync: true,
		ipcWriteOnReopen: true,
		authenticatedProjectExport: true,
		unauthorizedLogCount: 0,
	};
	await writeFile(
		path.join(outputRoot, "sidecar-result.json"),
		JSON.stringify(result, null, 2)
	);
	return result;
}
