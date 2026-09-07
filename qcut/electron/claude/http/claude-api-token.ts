import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { stateDir as resolveStateDir } from "../../native-pipeline/infra/xdg-paths.js";

/**
 * Bearer token for the editor HTTP API.
 *
 * `QCUT_API_TOKEN` wins when the environment sets it. Otherwise the app mints
 * a random token per launch and publishes it in an instance file that only the
 * current user can read, so the CLI, the plugin runner, and the embedded MCP
 * server can authenticate without anyone pasting secrets, while other local
 * accounts and sandboxed processes cannot drive the editor.
 */
export interface ClaudeApiTokenState {
	token: string;
	source: "env" | "generated";
}

export interface ClaudeInstanceInfo {
	host: string;
	port: number;
	pid: number;
	token: string;
	startedAt: string;
}

export function ensureClaudeApiToken({
	env = process.env,
}: {
	env?: NodeJS.ProcessEnv;
} = {}): ClaudeApiTokenState {
	const configured = env.QCUT_API_TOKEN?.trim();
	if (configured) return { token: configured, source: "env" };
	const token = randomBytes(24).toString("hex");
	env.QCUT_API_TOKEN = token;
	return { token, source: "generated" };
}

export function claudeInstancesDir({
	stateDir,
}: {
	stateDir?: string;
} = {}): string {
	return path.join(resolveStateDir(stateDir), "instances");
}

export function claudeInstanceInfoPath({
	port,
	stateDir,
}: {
	port: number;
	stateDir?: string;
}): string {
	return path.join(claudeInstancesDir({ stateDir }), `${port}.json`);
}

export function writeClaudeInstanceInfo({
	host = "127.0.0.1",
	port,
	pid = process.pid,
	token,
	stateDir,
}: {
	host?: string;
	port: number;
	pid?: number;
	token: string;
	stateDir?: string;
}): ClaudeInstanceInfo {
	pruneStaleClaudeInstances({ stateDir });
	const info: ClaudeInstanceInfo = {
		host,
		port,
		pid,
		token,
		startedAt: new Date().toISOString(),
	};
	const filePath = claudeInstanceInfoPath({ port, stateDir });
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	fs.writeFileSync(filePath, JSON.stringify(info, null, 2), {
		encoding: "utf8",
		mode: 0o600,
	});
	return info;
}

export function removeClaudeInstanceInfo({
	port,
	pid = process.pid,
	stateDir,
}: {
	port: number;
	pid?: number;
	stateDir?: string;
}): void {
	const existing = readClaudeInstanceInfo({ port, stateDir });
	// Only the instance that published the file may retract it.
	if (!existing || existing.pid !== pid) return;
	try {
		fs.unlinkSync(claudeInstanceInfoPath({ port, stateDir }));
	} catch {
		// Already gone.
	}
}

export function readClaudeInstanceInfo({
	port,
	stateDir,
}: {
	port: number;
	stateDir?: string;
}): ClaudeInstanceInfo | null {
	try {
		const parsed = JSON.parse(
			fs.readFileSync(claudeInstanceInfoPath({ port, stateDir }), "utf8")
		) as Partial<ClaudeInstanceInfo>;
		if (typeof parsed.token !== "string" || !parsed.token.trim()) return null;
		return {
			host:
				typeof parsed.host === "string" && parsed.host.trim()
					? parsed.host.trim()
					: "127.0.0.1",
			port,
			pid: typeof parsed.pid === "number" ? parsed.pid : 0,
			token: parsed.token.trim(),
			startedAt:
				typeof parsed.startedAt === "string"
					? parsed.startedAt
					: new Date(0).toISOString(),
		};
	} catch {
		return null;
	}
}

function listPublishedPorts({ stateDir }: { stateDir?: string }): number[] {
	try {
		return fs
			.readdirSync(claudeInstancesDir({ stateDir }))
			.map((name) => /^(\d+)\.json$/.exec(name)?.[1])
			.filter((port): port is string => port !== undefined)
			.map((port) => Number.parseInt(port, 10))
			.filter((port) => Number.isInteger(port) && port > 0);
	} catch {
		return [];
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to someone else.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Ports published by editors whose process is still alive, for discovery. */
export function listClaudeInstancePorts({
	stateDir,
}: {
	stateDir?: string;
} = {}): number[] {
	return listPublishedPorts({ stateDir }).filter((port) => {
		const info = readClaudeInstanceInfo({ port, stateDir });
		return info !== null && (info.pid === 0 || isProcessAlive(info.pid));
	});
}

/**
 * Remove instance files left behind by editors that died without running
 * `before-quit` (crash, SIGKILL). Returns the ports that were pruned.
 */
export function pruneStaleClaudeInstances({
	stateDir,
}: {
	stateDir?: string;
} = {}): number[] {
	const pruned: number[] = [];
	for (const port of listPublishedPorts({ stateDir })) {
		const info = readClaudeInstanceInfo({ port, stateDir });
		if (!info || info.pid === 0 || isProcessAlive(info.pid)) continue;
		try {
			fs.unlinkSync(claudeInstanceInfoPath({ port, stateDir }));
			pruned.push(port);
		} catch {
			// Someone else removed it first.
		}
	}
	return pruned;
}
