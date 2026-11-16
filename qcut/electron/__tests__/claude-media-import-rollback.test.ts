/**
 * An import of a restricted file through the HTTP API, when the main
 * process cannot finish the file's metadata in the time the API's process
 * waits for it.
 *
 * The API's process copies the file into the project, asks the main process
 * to write its restricted metadata, and takes the file away again when that
 * fails. The main process had begun the write in time, and the disk held it
 * up. The API's process gave up, removed the file and asked for the
 * metadata to be removed, which waited behind the write and was given up as
 * well. When the disk let go, the write was finished: restricted metadata
 * was left for a file that was gone, to stick to whatever file took that
 * name next.
 *
 * The two processes are two copies of the modules here: the API's process
 * is the copy this file imports, the main process a second one made for
 * each test, with its own queue of sidecar changes. What goes between them
 * is the bridge's own code over a real message port pair
 * (utility-bridge-kit.ts), and the import is the route's own, with its own
 * taking back.
 */

import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/** Runs before a written file is put in place under the name given. */
	beforePlacing: undefined as undefined | ((name: string) => Promise<void>),
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => testState.documentsRoot),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock("electron-log", () => ({
	default: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...real,
		// An import's sidecar gets its name by a rename.
		rename: async (...args: Parameters<typeof real.rename>) => {
			await hooks.beforePlacing?.(String(args[1]));
			return real.rename(...args);
		},
	};
});

import * as fs from "node:fs/promises";
import { makeRestrictedMetadataChangesThrough } from "../claude/handlers/claude-media-restricted-metadata.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "../claude/http/claude-http-shared-routes";
import type { Router } from "../claude/utils/http-router";
import { MAIN_REQUEST_TIMEOUT_MS } from "../utility/utility-main-requests.js";
import { restrictedMetadataChangesThroughMain } from "../utility/utility-media-requests.js";
import {
	bridgeToTheMainProcess,
	closeBridges,
	type TestBridge,
} from "./utility-bridge-kit.js";

type RouteHandler = (req: {
	params: Record<string, string>;
	query: Record<string, string>;
	body?: unknown;
}) => Promise<unknown>;

const PROJECT_ID = "restricted-import-test";
const IMPORT = "POST /api/claude/media/:projectId/import";
const RESTRICTED = {
	animatedSticker: true,
	batchId: "jianying-2026-08-23-batch-18-v2",
	checksumSha256:
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	itemId: "42001",
	redistribution: "prohibited",
	referenceOnly: true,
	source: "sticker-lab",
	usage: "internal-reference-only",
} as const;

describe("a restricted import whose metadata the disk holds up", () => {
	let bridge: TestBridge;
	let source = "";
	const mediaFolder = () =>
		path.join(testState.documentsRoot, "QCut", "Projects", PROJECT_ID, "media");
	const sidecarFolder = () =>
		path.join(mediaFolder(), ".qcut-restricted-media");
	const mediaFiles = async () =>
		(await fs.readdir(mediaFolder())).filter((name) => !name.startsWith("."));
	const sidecars = async () =>
		(await fs.readdir(sidecarFolder())).filter((name) =>
			name.endsWith(".json")
		);
	/** The changes asked of the main process, in order. */
	const asked = () =>
		bridge.asked.map((message) => String(message.data.change));

	/**
	 * The import route as the HTTP API's process has it, asking the main
	 * process for every change to a sidecar.
	 */
	function importRoute(): {
		importMedia: () => Promise<unknown>;
		requestMediaImport: ReturnType<typeof vi.fn>;
	} {
		const handlers = new Map<string, RouteHandler>();
		const record =
			(method: string) => (route: string, handler: RouteHandler) => {
				handlers.set(`${method} ${route}`, handler);
			};
		const requestMediaImport = vi.fn(async () => undefined);
		const accessor = new Proxy({} as WindowAccessor, {
			get(_target, property) {
				if (property === "requestMediaImport") return requestMediaImport;
				if (property === "requestStateSnapshot") {
					return async () => ({
						version: 1,
						timestamp: Date.now(),
						state: { project: { activeProject: { id: PROJECT_ID } } },
					});
				}
				if (property === "getAppVersion") return () => "0.0.1-test";
				if (property === "getWindow") {
					return () => ({ webContents: { send: () => {} } });
				}
				return vi.fn(async () => ({}));
			},
		});
		registerSharedRoutes(
			{
				get: record("GET"),
				post: record("POST"),
				patch: record("PATCH"),
				delete: record("DELETE"),
				handle: () => {},
			} as unknown as Router,
			accessor
		);
		const handler = handlers.get(IMPORT);
		if (!handler) throw new Error(`Route not registered: ${IMPORT}`);
		return {
			importMedia: () =>
				handler({
					params: { projectId: PROJECT_ID },
					query: {},
					body: { source, metadata: RESTRICTED },
				}),
			requestMediaImport,
		};
	}

	beforeEach(async () => {
		testState.documentsRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-restricted-import-")
		);
		source = path.join(testState.documentsRoot, "incoming", "wanted.gif");
		await fs.mkdir(path.dirname(source));
		await fs.writeFile(source, "GIF89a: the picture");

		// The main process: a copy of its own of what it does for the media
		// requests, behind the bridge. This file's copy is the API's process,
		// which makes no change to a sidecar itself.
		vi.resetModules();
		const main = await import("../utility/utility-media-bridge.js");
		bridge = bridgeToTheMainProcess({
			handle: async (channel, data, deadline) => {
				const answer = main.handleWindowFreeMediaRequest({
					channel,
					data,
					deadline,
				});
				if (!answer) throw new Error(`Not a media request: ${channel}`);
				return answer;
			},
		});
		makeRestrictedMetadataChangesThrough(
			restrictedMetadataChangesThroughMain({
				requestFromMain: bridge.requestFromMain,
			})
		);
	});

	afterEach(async () => {
		hooks.beforePlacing = undefined;
		makeRestrictedMetadataChangesThrough(undefined);
		closeBridges();
		vi.useRealTimers();
		await fs.rm(testState.documentsRoot, { recursive: true, force: true });
	});

	it("brings the file in with its metadata when the disk does not", async () => {
		const { importMedia, requestMediaImport } = importRoute();
		await expect(importMedia()).resolves.toMatchObject({ name: "wanted.gif" });
		expect(asked()).toEqual(["persist"]);
		expect(await mediaFiles()).toEqual(["wanted.gif"]);
		expect(await sidecars()).toHaveLength(1);
		expect(requestMediaImport).toHaveBeenCalledTimes(1);
	});

	it("leaves neither the file nor its metadata when the write is finished after the import has given up and rolled back", async () => {
		const { importMedia, requestMediaImport } = importRoute();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		let goOn = () => {};
		const released = new Promise<void>((resolve) => {
			goOn = resolve;
		});
		let heldUp = false;
		hooks.beforePlacing = async (name) => {
			if (!name.endsWith(".json") || heldUp) return;
			heldUp = true;
			await released;
		};

		const imported = importMedia().then(
			() => "imported",
			(error: unknown) => String(error)
		);
		// The file is in the project, and its metadata is being written.
		await vi.waitFor(() => expect(heldUp).toBe(true));
		expect(await mediaFiles()).toEqual(["wanted.gif"]);

		// The API's process waits its ten seconds, gives up, and rolls back:
		// the file goes, and the main process is asked to remove the sidecar.
		await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
		await vi.waitFor(() => expect(asked()).toEqual(["persist", "remove"]));
		expect(await mediaFiles()).toEqual([]);
		// That waits behind the write, and is given up after ten more.
		await vi.advanceTimersByTimeAsync(MAIN_REQUEST_TIMEOUT_MS);
		expect(await imported).toBe(
			"Error: Main process request timed out: media:restricted-metadata"
		);
		expect(bridge.answers).toEqual([]);
		// The editor was never told of the file.
		expect(requestMediaImport).not.toHaveBeenCalled();

		// The disk lets go: the write is finished, twenty seconds late.
		goOn();
		await vi.waitFor(() => expect(bridge.answers).toHaveLength(2));
		expect(bridge.answers.map((answer) => answer.error)).toEqual([
			"The change to restricted media metadata took longer than the request for it waits; it was taken back",
			"The change to restricted media metadata waited for its turn longer than the request for it; it was not made",
		]);
		// Nothing is left for a file of that name to inherit.
		expect(await sidecars()).toEqual([]);
		expect(await mediaFiles()).toEqual([]);
		expect(
			(await fs.readdir(sidecarFolder())).filter((name) =>
				name.endsWith(".tmp")
			)
		).toEqual([]);
	});

	/**
	 * The write is finished while the import still waits, and its removal
	 * gets its turn: the rollback's own request does the taking away.
	 */
	it("removes the metadata by the rollback's own request when the editor does not take the file", async () => {
		const { importMedia, requestMediaImport } = importRoute();
		requestMediaImport.mockRejectedValueOnce(
			new Error("IndexedDB write failed")
		);
		await expect(importMedia()).rejects.toThrow("IndexedDB write failed");
		expect(asked()).toEqual(["persist", "remove"]);
		expect(bridge.answers.map((answer) => answer.error)).toEqual([
			undefined,
			undefined,
		]);
		expect(await sidecars()).toEqual([]);
		expect(await mediaFiles()).toEqual([]);
	});
});
