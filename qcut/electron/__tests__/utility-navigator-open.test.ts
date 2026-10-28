import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * N12.2 (2026-10-28 trailer report): right after `project:duplicate` +
 * `navigator open`, edit commands failed with "No active editor project" or
 * "Timeout waiting for transaction begin". In the packaged app :8765 is
 * served by the utility process, whose open route gave up after 10 s while
 * the editor waits up to 20 s for a project to load: a large project came
 * back "timed out" while it was still loading.
 */

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", getVersion: () => "0.0.0-test" },
	ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import {
	startUtilityHttpServer,
	stopUtilityHttpServer,
} from "../utility/utility-http-server.js";

const TOKEN = "navigator-open-test-token";
let port = 0;
const calls: Array<{ channel: string; options?: { timeoutMs?: number } }> = [];

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === "string") throw new Error("no port");
	return address.port;
}

describe("utility navigator open", () => {
	beforeAll(async () => {
		process.env.QCUT_API_TOKEN = TOKEN;
		port = await freePort();
		startUtilityHttpServer({
			port,
			appVersion: "0.0.0-test",
			requestFromMain: (channel, _data, options) => {
				calls.push({ channel, options });
				if (channel !== "navigate-to-project") return Promise.resolve({});
				// A project that takes 11 s to load, as a large one can.
				return new Promise((resolve) =>
					setTimeout(
						() => resolve({ navigated: true, projectId: "big-project" }),
						11_000
					)
				);
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	afterAll(() => {
		stopUtilityHttpServer();
		delete process.env.QCUT_API_TOKEN;
	});

	it("waits for a slow project to finish loading", async () => {
		const response = await fetch(
			`http://127.0.0.1:${port}/api/claude/navigator/open`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ projectId: "big-project" }),
			}
		);
		const body = (await response.json()) as {
			success: boolean;
			data?: { navigated: boolean };
		};
		expect(response.status).toBe(200);
		expect(body.data).toEqual({ navigated: true, projectId: "big-project" });
		const open = calls.find((call) => call.channel === "navigate-to-project");
		expect(open?.options?.timeoutMs).toBeGreaterThanOrEqual(25_000);
	}, 20_000);

	it("takes the wait from a constants module, not the main-process handler", () => {
		// The navigator handler uses ipcMain and BrowserWindow, main-process
		// APIs the utility process must not load.
		const source = readFileSync(
			new URL("../utility/utility-http-server.ts", import.meta.url),
			"utf8"
		);
		expect(source).not.toContain("claude-navigator-handler");
		expect(source).toContain("../claude/utils/navigation-timeout.js");
	});
});
