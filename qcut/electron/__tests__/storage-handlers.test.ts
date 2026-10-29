import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	userData: "",
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => mocks.userData },
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
			mocks.handlers.set(channel, handler);
		},
	},
}));

import { registerStorageHandlers } from "../main-ipc/storage-handlers.js";
import type { MainIpcDeps } from "../main-ipc/types.js";

const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
const KEY = "video-editor-projects_projects_6a3fd63a";

async function load(): Promise<unknown> {
	return mocks.handlers.get("storage:load")?.({}, KEY);
}

beforeEach(async () => {
	mocks.userData = await fs.mkdtemp(
		path.join(os.tmpdir(), "qcut-storage-ipc-")
	);
	await fs.mkdir(path.join(mocks.userData, "projects"));
	registerStorageHandlers({ logger } as unknown as MainIpcDeps);
});

afterEach(async () => {
	vi.clearAllMocks();
	await fs.rm(mocks.userData, { recursive: true, force: true });
});

describe("storage:load", () => {
	it("hands over the JSON before a stray tail and says where the original was kept", async () => {
		const file = path.join(mocks.userData, "projects", `${KEY}.json`);
		await fs.writeFile(file, '{"name":"Transition Parity - BT709"}}');
		expect(await load()).toEqual({ name: "Transition Parity - BT709" });
		expect(logger.error).not.toHaveBeenCalled();
		const [message] = logger.warn.mock.calls[0];
		expect(message).toContain(
			`"${KEY}" has 1 stray character(s) after its JSON`
		);
		expect(message).toContain(`${file}.damaged-`);
		expect(await fs.readFile(file, "utf8")).toBe(
			'{"name":"Transition Parity - BT709"}}'
		);
	});

	it("reports other damage with the file's path and loads nothing", async () => {
		const file = path.join(mocks.userData, "projects", `${KEY}.json`);
		await fs.writeFile(file, '{"name":');
		expect(await load()).toBeNull();
		expect(logger.error.mock.calls[0][0]).toBe(
			`[Storage] Corrupted JSON file for key "${KEY}" (${file}), left as it is:`
		);
		expect(await fs.readdir(path.join(mocks.userData, "projects"))).toEqual([
			`${KEY}.json`,
		]);
	});

	it("loads nothing for a project that was never saved", async () => {
		expect(await load()).toBeNull();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});
});
