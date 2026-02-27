/**
 * Discover unmanaged Claude Code and Codex CLI sessions.
 *
 * Finds claude/codex processes running in terminals (not managed by qagent,
 * not inside tmux, not the Claude Desktop app) and creates lightweight
 * DashboardSession objects so they appear on the dashboard.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DashboardSession } from "./types.js";

const execFileAsync = promisify(execFile);

interface CLIProcess {
	pid: number;
	tty: string;
	args: string;
	agent: "claude-code" | "codex";
}

const CLAUDE_RE = /(?:^|\/)claude(?:\s|$)/;
const CODEX_RE = /(?:^|\/)codex(?:\s|$)/;

/**
 * Discover claude and codex processes via `ps`.
 * Excludes processes with no TTY (??) which are background/Desktop processes.
 */
async function discoverCLIProcesses(): Promise<CLIProcess[]> {
	let stdout: string;
	try {
		const result = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
			timeout: 5_000,
		});
		stdout = result.stdout;
	} catch {
		return [];
	}

	const processes: CLIProcess[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trimStart();
		const cols = trimmed.split(/\s+/);
		if (cols.length < 3) continue;

		const pid = parseInt(cols[0]!, 10);
		const tty = cols[1]!;
		const args = cols.slice(2).join(" ");

		// Skip background processes (Claude Desktop, daemons)
		if (tty === "??" || tty === "-") continue;

		let agent: "claude-code" | "codex" | null = null;
		if (CLAUDE_RE.test(args)) agent = "claude-code";
		else if (CODEX_RE.test(args)) agent = "codex";

		if (agent && Number.isFinite(pid)) {
			processes.push({ pid, tty, args, agent });
		}
	}

	return processes;
}

/**
 * Get tmux pane TTYs to exclude processes running inside tmux.
 */
async function getTmuxPaneTTYs(): Promise<Set<string>> {
	try {
		const { stdout } = await execFileAsync(
			"tmux",
			["list-panes", "-a", "-F", "#{pane_tty}"],
			{ timeout: 3_000 },
		);
		const ttys = new Set<string>();
		for (const line of stdout.split("\n")) {
			const tty = line.trim();
			if (tty) {
				// ps shows short TTY (e.g. "s009"), tmux shows full path (e.g. "/dev/ttys009")
				// Normalize: extract the short form
				const short = tty.replace(/^\/dev\/tty/, "");
				ttys.add(short);
				ttys.add(tty);
			}
		}
		return ttys;
	} catch {
		// tmux not running or not installed — no pane TTYs to exclude
		return new Set();
	}
}

/**
 * Resolve a process's working directory via lsof.
 */
async function resolveProcessCwd(pid: number): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"lsof",
			["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
			{ timeout: 3_000 },
		);
		for (const line of stdout.split("\n")) {
			if (line.startsWith("n") && line.length > 1) {
				return line.slice(1);
			}
		}
		return null;
	} catch {
		return null;
	}
}

function cliProcessToDashboard(
	proc: CLIProcess,
	cwd: string | null,
): DashboardSession {
	const now = new Date().toISOString();
	return {
		id: `${proc.agent}:${proc.pid}`,
		projectId: "",
		status: "working",
		activity: null,
		branch: null,
		issueId: null,
		issueUrl: null,
		issueLabel: null,
		issueTitle: null,
		summary: null,
		summaryIsFallback: false,
		createdAt: now,
		lastActivityAt: now,
		pr: null,
		metadata: {
			pid: String(proc.pid),
			tty: proc.tty,
			agent: proc.agent,
			command: proc.args,
			...(cwd ? { cwd } : {}),
		},
		managed: false,
	};
}

/**
 * Find a single CLI session by its dashboard ID (e.g. "claude-code:1293").
 * Used by /api/sessions/[id] to serve detail pages.
 */
export async function findCLISession(
	id: string,
): Promise<DashboardSession | null> {
	const match = id.match(/^(claude-code|codex):(\d+)$/);
	if (!match) return null;

	const agent = match[1] as "claude-code" | "codex";
	const pid = parseInt(match[2]!, 10);

	const processes = await discoverCLIProcesses();
	const proc = processes.find((p) => p.agent === agent && p.pid === pid);
	if (!proc) return null;

	const cwd = await resolveProcessCwd(pid);
	return cliProcessToDashboard(proc, cwd);
}

/**
 * Merge managed sessions with unmanaged CLI agent processes.
 *
 * Must be called AFTER mergeWithUnmanagedTmux so that processes running
 * inside tmux (managed or unmanaged) are already accounted for.
 */
export async function mergeWithUnmanagedCLI(
	managedSessions: DashboardSession[],
): Promise<DashboardSession[]> {
	const processes = await discoverCLIProcesses();
	if (processes.length === 0) return managedSessions;

	// Exclude processes in tmux panes (covered by tmux discovery)
	const tmuxTTYs = await getTmuxPaneTTYs();

	// Collect PIDs already claimed by managed sessions
	const claimedPids = new Set<number>();
	for (const s of managedSessions) {
		if (s.metadata.pid) {
			claimedPids.add(parseInt(s.metadata.pid, 10));
		}
	}

	const unmanaged = processes.filter((p) => {
		if (claimedPids.has(p.pid)) return false;
		// Check both short and full TTY forms against tmux panes
		if (tmuxTTYs.has(p.tty)) return false;
		const shortTTY = p.tty.replace(/^\/dev\/tty/, "");
		if (tmuxTTYs.has(shortTTY)) return false;
		return true;
	});

	if (unmanaged.length === 0) return managedSessions;

	// Resolve CWDs in parallel
	const cwds = await Promise.all(
		unmanaged.map((p) => resolveProcessCwd(p.pid)),
	);

	const unmanagedSessions = unmanaged.map((p, i) =>
		cliProcessToDashboard(p, cwds[i] ?? null),
	);

	return [...managedSessions, ...unmanagedSessions];
}
