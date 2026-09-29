// @vitest-environment node
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeSnapshotIdentity } from "../jianying-motion-tracking/runtime-snapshot-identity.js";

const temporaryDirectories: string[] = [];

async function temporarySnapshot() {
	const snapshotPath = await mkdtemp(
		path.join(os.tmpdir(), "qcut-runtime-identity-test-")
	);
	temporaryDirectories.push(snapshotPath);
	await writeFile(path.join(snapshotPath, "manifest.json"), "manifest-a");
	await writeFile(path.join(snapshotPath, "runtime.bin"), "payload-a");
	const initialTime = new Date("2026-01-01T00:00:00.000Z");
	await Promise.all(
		["manifest.json", "runtime.bin"].map((relativePath) =>
			utimes(path.join(snapshotPath, relativePath), initialTime, initialTime)
		)
	);
	return snapshotPath;
}

async function replaceSnapshotFile({
	snapshotPath,
	relativePath,
	contents,
}: {
	snapshotPath: string;
	relativePath: string;
	contents: string;
}) {
	const filePath = path.join(snapshotPath, relativePath);
	await writeFile(filePath, contents);
	// This cache identity uses metadata, not content; avoid filesystem clock granularity.
	const replacementTime = new Date("2026-01-01T00:00:01.000Z");
	await utimes(filePath, replacementTime, replacementTime);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe("Jianying runtime snapshot identity", () => {
	it("stays stable when runtime metadata is unchanged", async () => {
		const snapshotPath = await temporarySnapshot();
		const input = { relativePaths: ["runtime.bin"], snapshotPath };
		const first = await runtimeSnapshotIdentity(input);
		expect(await runtimeSnapshotIdentity(input)).toBe(first);
	});

	it("changes when same-sized runtime files receive new metadata", async () => {
		const snapshotPath = await temporarySnapshot();
		const first = await runtimeSnapshotIdentity({
			relativePaths: ["runtime.bin"],
			snapshotPath,
		});
		await replaceSnapshotFile({
			snapshotPath,
			relativePath: "runtime.bin",
			contents: "payload-b",
		});
		const second = await runtimeSnapshotIdentity({
			relativePaths: ["runtime.bin"],
			snapshotPath,
		});

		expect(second).not.toBe(first);
	});

	it("changes when manifest metadata changes", async () => {
		const snapshotPath = await temporarySnapshot();
		const first = await runtimeSnapshotIdentity({
			relativePaths: ["runtime.bin"],
			snapshotPath,
		});
		await replaceSnapshotFile({
			snapshotPath,
			relativePath: "manifest.json",
			contents: "manifest-b",
		});
		const second = await runtimeSnapshotIdentity({
			relativePaths: ["runtime.bin"],
			snapshotPath,
		});

		expect(second).not.toBe(first);
	});
});
