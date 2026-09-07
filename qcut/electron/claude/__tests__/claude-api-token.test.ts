import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	claudeInstanceInfoPath,
	claudeInstancesDir,
	ensureClaudeApiToken,
	listClaudeInstancePorts,
	pruneStaleClaudeInstances,
	readClaudeInstanceInfo,
	removeClaudeInstanceInfo,
	writeClaudeInstanceInfo,
} from "../http/claude-api-token.js";

/** A pid no live process can have on macOS, Linux, or Windows. */
const DEAD_PID = 2_147_483_646;

const tempDirs: string[] = [];

function tempStateDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-api-token-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("ensureClaudeApiToken", () => {
	it("keeps a configured QCUT_API_TOKEN", () => {
		const env: NodeJS.ProcessEnv = { QCUT_API_TOKEN: "  configured  " };
		expect(ensureClaudeApiToken({ env })).toEqual({
			token: "configured",
			source: "env",
		});
	});

	it("mints a random token and exports it to the environment otherwise", () => {
		const env: NodeJS.ProcessEnv = { QCUT_API_TOKEN: "   " };
		const minted = ensureClaudeApiToken({ env });
		expect(minted.source).toBe("generated");
		expect(minted.token).toMatch(/^[0-9a-f]{48}$/);
		expect(env.QCUT_API_TOKEN).toBe(minted.token);
		expect(ensureClaudeApiToken({ env: {} }).token).not.toBe(minted.token);
	});
});

describe("instance files", () => {
	it("publishes, reads, lists, and retracts the file for a port", () => {
		const stateDir = tempStateDir();
		const info = writeClaudeInstanceInfo({
			port: 8765,
			token: "published",
			stateDir,
		});
		const filePath = claudeInstanceInfoPath({ port: 8765, stateDir });

		expect(info.pid).toBe(process.pid);
		expect(existsSync(filePath)).toBe(true);
		if (process.platform !== "win32") {
			expect(statSync(filePath).mode & 0o777).toBe(0o600);
		}
		expect(readClaudeInstanceInfo({ port: 8765, stateDir })).toEqual(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 8765,
				pid: process.pid,
				token: "published",
			})
		);
		expect(listClaudeInstancePorts({ stateDir })).toEqual([8765]);

		removeClaudeInstanceInfo({ port: 8765, pid: DEAD_PID, stateDir });
		expect(existsSync(filePath)).toBe(true);
		removeClaudeInstanceInfo({ port: 8765, stateDir });
		expect(existsSync(filePath)).toBe(false);
		expect(readClaudeInstanceInfo({ port: 8765, stateDir })).toBeNull();
	});

	it("hides dead publishers from discovery and prunes them on the next publish", () => {
		const stateDir = tempStateDir();
		writeClaudeInstanceInfo({
			port: 9001,
			pid: DEAD_PID,
			token: "stale",
			stateDir,
		});
		expect(listClaudeInstancePorts({ stateDir })).toEqual([]);
		expect(existsSync(claudeInstanceInfoPath({ port: 9001, stateDir }))).toBe(
			true
		);

		writeClaudeInstanceInfo({ port: 9002, token: "live", stateDir });
		expect(existsSync(claudeInstanceInfoPath({ port: 9001, stateDir }))).toBe(
			false
		);
		expect(listClaudeInstancePorts({ stateDir })).toEqual([9002]);
		expect(pruneStaleClaudeInstances({ stateDir })).toEqual([]);
	});

	it("resolves the instance directory under XDG_STATE_HOME", () => {
		const home = tempStateDir();
		vi.stubEnv("XDG_STATE_HOME", home);
		expect(claudeInstancesDir()).toBe(join(home, "qcut-pipeline", "instances"));
	});
});
