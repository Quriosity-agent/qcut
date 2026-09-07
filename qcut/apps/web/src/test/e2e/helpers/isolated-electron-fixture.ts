/**
 * Playwright fixture launching an isolated QCut Electron instance.
 *
 * A temporary user-data directory sidesteps the single-instance lock so the
 * test can coexist with a running QCut, and a dedicated QCUT_API_PORT keeps
 * the editor HTTP bridge off the user's port. Tests receive the allocated
 * port as the `apiPort` fixture.
 *
 * The editor HTTP API always requires a bearer token: the app takes
 * QCUT_API_TOKEN from its environment or mints one per launch and publishes
 * it under `<XDG_STATE_HOME>/qcut-pipeline/instances/<port>.json`. Both the
 * token and a temporary XDG_STATE_HOME are exported to this worker's
 * `process.env` for the duration of the test, because helpers and CLI runs
 * spread `process.env` into their requests and child processes.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { test as qcutTest } from "./electron-helpers";

export interface IsolatedElectronFixtures {
	apiPort: number;
	/**
	 * Bearer token the app was launched with, or null when `mintApiToken`
	 * asked the app to mint its own.
	 */
	apiToken: string | null;
	/** XDG_STATE_HOME seen by the app and by CLI runs during the test. */
	stateHome: string;
	/** Launch without QCUT_API_TOKEN so the app mints a per-launch token. */
	mintApiToken: boolean;
}

export async function findAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not allocate an API port");
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

function restoreEnv({
	name,
	value,
}: {
	name: string;
	value: string | undefined;
}): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

export const isolatedElectronTest = qcutTest.extend<IsolatedElectronFixtures>({
	mintApiToken: [false, { option: true }],
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require empty destructuring
	apiPort: async ({}, use) => {
		await use(await findAvailablePort());
	},
	apiToken: async ({ mintApiToken }, use) => {
		await use(
			mintApiToken
				? null
				: process.env.QCUT_API_TOKEN?.trim() || randomBytes(16).toString("hex")
		);
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require empty destructuring
	stateHome: async ({}, use) => {
		const stateHome = await mkdtemp(
			path.join(tmpdir(), "qcut-isolated-state-")
		);
		await use(stateHome);
		await rm(stateHome, { force: true, recursive: true });
	},
	electronApp: async ({ apiPort, apiToken, stateHome }, use) => {
		const userDataDirectory = await mkdtemp(
			path.join(tmpdir(), "qcut-isolated-e2e-")
		);
		const previousToken = process.env.QCUT_API_TOKEN;
		const previousStateHome = process.env.XDG_STATE_HOME;
		if (apiToken) {
			process.env.QCUT_API_TOKEN = apiToken;
		} else {
			delete process.env.QCUT_API_TOKEN;
		}
		process.env.XDG_STATE_HOME = stateHome;
		try {
			const electronApp = await electron.launch({
				args: ["dist/electron/main.js", `--user-data-dir=${userDataDirectory}`],
				env: {
					...process.env,
					ELECTRON_DISABLE_GPU: "1",
					NODE_ENV: "test",
					QCUT_API_PORT: String(apiPort),
					XDG_STATE_HOME: stateHome,
				},
			});
			await use(electronApp);
			await electronApp.close();
		} finally {
			restoreEnv({ name: "QCUT_API_TOKEN", value: previousToken });
			restoreEnv({ name: "XDG_STATE_HOME", value: previousStateHome });
			await rm(userDataDirectory, { force: true, recursive: true });
		}
	},
});
