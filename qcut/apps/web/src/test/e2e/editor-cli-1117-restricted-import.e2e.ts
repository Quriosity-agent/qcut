/**
 * An import of a restricted file whose metadata the main process cannot
 * finish in time, on the real app: the HTTP API in its utility process, the
 * main process, and Electron's own port between the two.
 *
 * The API's process copies the file into the project, asks the main process
 * to write the file's restricted metadata, waits ten seconds, and takes the
 * file away again when no answer has come. Its request to remove the
 * metadata waits behind the write, ten seconds more, and is given up too.
 * When the write is finished after all that, nothing may be left of it:
 * metadata left for a file that is gone would stick to whatever file took
 * its name next.
 *
 * Nothing in the app is built for this test. The test reaches into the
 * running main process and holds up the one call that gives the sidecar its
 * name, as a slow disk would.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

/** Longer than the API's process waits for the write and for its removal. */
const HELD_UP_MS = 26_000;
/** How long that process waits for one answer of the main process. */
const BRIDGE_WAIT_MS = 10_000;

const RESTRICTED = {
	source: "sticker-lab",
	animatedSticker: true,
	referenceOnly: true,
	usage: "internal-reference-only",
	redistribution: "prohibited",
	batchId: "jianying-2026-08-23-batch-18-v2",
	itemId: "7134619769205951784",
	checksumSha256: "a".repeat(64),
};

/** A GIF of one pixel. */
const ONE_PIXEL_GIF = Buffer.from(
	"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
	"base64"
);

/** Runs the CLI and returns the data of its JSON answer. */
function cli<T>({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<T> {
	return new Promise((resolve, reject) => {
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 16 * 1024 * 1024,
				timeout: 120_000,
			},
			(error, stdout, stderr) => {
				try {
					const envelope = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
						status: string;
						error?: string;
						data?: { data?: T };
					};
					if (envelope.status !== "ok") throw new Error(envelope.error);
					resolve(envelope.data?.data as T);
				} catch (unreadable) {
					reject(
						new Error(
							`${args.join(" ")}: ${unreadable instanceof Error ? unreadable.message : String(unreadable)}${error ? ` (${error.message})` : ""}\n${stdout}\n${stderr}`
						)
					);
				}
			}
		);
	});
}

/** What the test keeps in the main process while it holds the write up. */
interface HeldUp {
	heldAt: number;
	letGoAt: number;
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(300_000);

test("QCut 1117: a restricted import the main process cannot finish in time leaves nothing behind", async ({
	apiPort,
	apiToken,
	electronApp,
	page,
}) => {
	await page.waitForLoadState("domcontentloaded");
	const { projectId } = await cli<{ projectId: string }>({
		apiPort,
		args: [
			"editor:project:create",
			"--name",
			"QCut1117 E2E (delete me)",
			"--open",
		],
	});
	const api = `http://127.0.0.1:${apiPort}/api/claude/media/${projectId}`;
	const headers = {
		Authorization: `Bearer ${apiToken}`,
		"Content-Type": "application/json",
	};
	// The project is open once its media can be listed.
	await expect
		.poll(async () => (await fetch(api, { headers })).status, {
			timeout: 60_000,
		})
		.toBe(200);

	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-1117-restricted-"));
	const source = path.join(workDir, "wanted.gif");
	writeFileSync(source, ONE_PIXEL_GIF);
	const documents = await electronApp.evaluate(({ app }) =>
		app.getPath("documents")
	);
	const mediaFolder = path.join(
		documents,
		"QCut",
		"Projects",
		projectId,
		"media"
	);
	const sidecarFolder = path.join(mediaFolder, ".qcut-restricted-media");
	/** The files of the media folder itself: it has folders of its own too. */
	const mediaFiles = () =>
		existsSync(mediaFolder)
			? readdirSync(mediaFolder, { withFileTypes: true })
					.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
					.map((entry) => entry.name)
			: [];
	const inSidecarFolder = () =>
		existsSync(sidecarFolder) ? readdirSync(sidecarFolder) : [];

	// In the main process: the first file that is given a name in a sidecar
	// folder gets it late. Everything else is as it is.
	await electronApp.evaluate((_electron, heldUpMs) => {
		type Rename = (from: unknown, to: unknown) => Promise<void>;
		const files = (
			process as unknown as {
				getBuiltinModule: (id: string) => { rename: Rename };
			}
		).getBuiltinModule("node:fs/promises");
		const rename = files.rename;
		const heldUp = { heldAt: 0, letGoAt: 0 };
		(globalThis as unknown as { qcutE2eHeldUp: HeldUp }).qcutE2eHeldUp = heldUp;
		files.rename = async (from, to) => {
			if (heldUp.heldAt > 0 || !String(to).includes(".qcut-restricted-media")) {
				return rename(from, to);
			}
			heldUp.heldAt = Date.now();
			await new Promise((resolve) => setTimeout(resolve, heldUpMs));
			try {
				await rename(from, to);
			} finally {
				heldUp.letGoAt = Date.now();
				files.rename = rename;
			}
		};
	}, HELD_UP_MS);
	const heldUp = () =>
		electronApp.evaluate(
			() => (globalThis as unknown as { qcutE2eHeldUp: HeldUp }).qcutE2eHeldUp
		);

	// The import, through the HTTP API.
	const asked = Date.now();
	const response = await fetch(`${api}/import`, {
		method: "POST",
		headers,
		body: JSON.stringify({ source, metadata: RESTRICTED }),
	});
	const waited = Date.now() - asked;
	const answer = (await response.json()) as {
		success: boolean;
		error?: string;
	};

	// It failed for the reason this is about, after the two waits: one for
	// the write, one for the removal its rollback asked for.
	expect(answer.success).toBe(false);
	expect(answer.error).toContain(
		"Main process request timed out: media:restricted-metadata"
	);
	expect(waited).toBeGreaterThan(2 * BRIDGE_WAIT_MS - 1500);
	expect(waited).toBeLessThan(HELD_UP_MS);
	// The write is still held up in the main process: it had begun in time.
	const whileHeld = await heldUp();
	expect(whileHeld.heldAt).toBeGreaterThan(0);
	expect(whileHeld.letGoAt).toBe(0);
	// The file is gone again; what was written of its metadata has no name
	// yet.
	expect(mediaFiles()).toEqual([]);
	expect(inSidecarFolder().filter((name) => name.endsWith(".json"))).toEqual(
		[]
	);

	// The disk lets go, and the main process finishes the write.
	await expect
		.poll(async () => (await heldUp()).letGoAt, { timeout: 30_000 })
		.toBeGreaterThan(0);
	// Nothing of it stays: no sidecar, no temporary file, no media file.
	await expect.poll(inSidecarFolder, { timeout: 10_000 }).toEqual([]);
	await page.waitForTimeout(1500);
	expect(inSidecarFolder()).toEqual([]);
	expect(mediaFiles()).toEqual([]);

	// And the folder takes a file of that name as any other, afterwards.
	const again = await fetch(`${api}/import`, {
		method: "POST",
		headers,
		body: JSON.stringify({ source }),
	});
	expect(((await again.json()) as { success: boolean }).success).toBe(true);
	expect(mediaFiles()).toEqual(["wanted.gif"]);
	const listed = (await (await fetch(api, { headers })).json()) as {
		data: Array<{ name: string; metadata?: unknown }>;
	};
	const file = listed.data.find((media) => media.name === "wanted.gif");
	expect(file).toBeDefined();
	// It is an ordinary file: it has inherited no restriction.
	expect(file?.metadata).toBeUndefined();
	expect(inSidecarFolder()).toEqual([]);
});
