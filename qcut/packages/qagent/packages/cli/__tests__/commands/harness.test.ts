import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
	Session,
	SessionManager,
	RuntimeHandle,
} from "@composio/ao-core";

const { mockConfigRef, mockSessionManager, mockExec } = vi.hoisted(() => ({
	mockConfigRef: { current: null as Record<string, unknown> | null },
	mockSessionManager: {
		list: vi.fn(),
		kill: vi.fn(),
		cleanup: vi.fn(),
		get: vi.fn(),
		spawn: vi.fn(),
		spawnOrchestrator: vi.fn(),
		send: vi.fn(),
		restore: vi.fn(),
	},
	mockExec: vi.fn(),
}));

vi.mock("@composio/ao-core", async (importOriginal) => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const actual = await importOriginal<typeof import("@composio/ao-core")>();
	return {
		...actual,
		loadConfig: () => mockConfigRef.current,
	};
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
	getSessionManager: async (): Promise<SessionManager> =>
		mockSessionManager as unknown as SessionManager,
}));

vi.mock("../../src/lib/shell.js", () => ({
	exec: mockExec,
	execSilent: vi.fn(),
	tmux: vi.fn(),
	git: vi.fn(),
	gh: vi.fn(),
	getTmuxSessions: vi.fn().mockResolvedValue([]),
	getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

import { Command } from "commander";
import { registerHarness } from "../../src/commands/harness.js";

let program: Command;
let tmpDir: string;
let configPath: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function makeRuntimeHandle({
	id = "tmux-app-1",
	runtimeName = "tmux",
}: {
	id?: string;
	runtimeName?: string;
} = {}): RuntimeHandle {
	return {
		id,
		runtimeName,
		data: {},
	};
}

function makeSession({
	id = "app-1",
	status = "working",
	activity = "active",
	runtimeHandle = makeRuntimeHandle(),
}: {
	id?: string;
	status?: Session["status"];
	activity?: Session["activity"];
	runtimeHandle?: RuntimeHandle | null;
} = {}): Session {
	return {
		id,
		projectId: "my-app",
		status,
		activity,
		branch: "session/app-1",
		issueId: null,
		pr: null,
		workspacePath: "/tmp/worktree",
		runtimeHandle,
		agentInfo: null,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		metadata: {},
	};
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "ao-harness-test-"));
	configPath = join(tmpDir, "qagent.yaml");
	mockConfigRef.current = {
		configPath,
		port: 3000,
		readyThresholdMs: 300_000,
		defaults: {
			runtime: "tmux",
			agent: "claude-code",
			workspace: "worktree",
			notifiers: ["desktop"],
		},
		projects: {
			"my-app": {
				name: "My App",
				repo: "org/my-app",
				path: tmpDir,
				defaultBranch: "main",
				sessionPrefix: "app",
				agent: "claude-code",
			},
		},
		notifiers: {},
		notificationRouting: {},
		reactions: {},
	} as Record<string, unknown>;

	program = new Command();
	program.exitOverride();
	registerHarness(program);

	consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`process.exit(${code})`);
	});

	mockSessionManager.spawn.mockReset();
	mockSessionManager.get.mockReset();
	mockSessionManager.send.mockReset();
	mockSessionManager.kill.mockReset();
	mockExec.mockReset();
	mockExec.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	consoleLogSpy.mockRestore();
	consoleErrorSpy.mockRestore();
	exitSpy.mockRestore();
});

describe("harness command", () => {
	it("spawns a tracked harness session and persists store state", async () => {
		mockSessionManager.spawn.mockResolvedValue(makeSession({ id: "app-1" }));

		await program.parseAsync([
			"node",
			"test",
			"harness",
			"spawn",
			"codex",
			"Implement",
			"queue",
			"logic",
		]);

		expect(mockSessionManager.spawn).toHaveBeenCalledWith({
			projectId: "my-app",
			agent: "codex",
			prompt: expect.stringContaining("Implement queue logic"),
		});

		const storePath = join(tmpDir, ".qagent", "harness-sessions.json");
		expect(existsSync(storePath)).toBe(true);

		const store = JSON.parse(readFileSync(storePath, "utf-8")) as {
			defaultSessionKey: string;
			sessions: Record<string, { sessionId: string; agentId: string }>;
		};
		expect(store.defaultSessionKey).toBe("agent:codex:harness:app-1");
		expect(store.sessions["agent:codex:harness:app-1"].sessionId).toBe("app-1");
		expect(store.sessions["agent:codex:harness:app-1"].agentId).toBe("codex");
	});

	it("steers the default tracked session", async () => {
		mockSessionManager.spawn.mockResolvedValue(makeSession({ id: "app-1" }));

		await program.parseAsync([
			"node",
			"test",
			"harness",
			"spawn",
			"codex",
			"start",
		]);
		await program.parseAsync([
			"node",
			"test",
			"harness",
			"steer",
			"continue",
			"with",
			"tests",
		]);

		expect(mockSessionManager.send).toHaveBeenCalledWith(
			"app-1",
			"continue with tests"
		);
	});

	it("updates model and permissions options, then exposes them in status json", async () => {
		mockSessionManager.spawn.mockResolvedValue(makeSession({ id: "app-1" }));
		mockSessionManager.get.mockResolvedValue(
			makeSession({ id: "app-1", status: "working", activity: "ready" })
		);

		await program.parseAsync([
			"node",
			"test",
			"harness",
			"spawn",
			"codex",
			"do",
			"work",
		]);
		await program.parseAsync([
			"node",
			"test",
			"harness",
			"model",
			"openai/gpt-5.2",
		]);
		await program.parseAsync([
			"node",
			"test",
			"harness",
			"permissions",
			"strict",
		]);

		consoleLogSpy.mockClear();
		await program.parseAsync(["node", "test", "harness", "status", "--json"]);

		const payload = String(
			consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0]
		);
		const data = JSON.parse(payload) as Array<{
			runtimeOptions: { model?: string; permissions?: string };
			liveStatus: string;
		}>;
		expect(data).toHaveLength(1);
		expect(data[0].runtimeOptions.model).toBe("openai/gpt-5.2");
		expect(data[0].runtimeOptions.permissions).toBe("strict");
		expect(data[0].liveStatus).toBe("working");
	});

	it("cancels with tmux ctrl-c when runtime is tmux", async () => {
		mockSessionManager.spawn.mockResolvedValue(makeSession({ id: "app-1" }));
		mockSessionManager.get.mockResolvedValue(
			makeSession({
				id: "app-1",
				runtimeHandle: makeRuntimeHandle({ id: "tmux-target-1" }),
			})
		);

		await program.parseAsync([
			"node",
			"test",
			"harness",
			"spawn",
			"codex",
			"start",
		]);
		await program.parseAsync(["node", "test", "harness", "cancel"]);

		expect(mockExec).toHaveBeenCalledWith("tmux", [
			"send-keys",
			"-t",
			"tmux-target-1",
			"C-c",
		]);
	});

	it("closes tracked session and removes it from store", async () => {
		mockSessionManager.spawn.mockResolvedValue(makeSession({ id: "app-1" }));
		mockSessionManager.kill.mockResolvedValue(undefined);

		await program.parseAsync([
			"node",
			"test",
			"harness",
			"spawn",
			"codex",
			"start",
		]);
		await program.parseAsync(["node", "test", "harness", "close"]);

		expect(mockSessionManager.kill).toHaveBeenCalledWith("app-1");

		const storePath = join(tmpDir, ".qagent", "harness-sessions.json");
		const store = JSON.parse(readFileSync(storePath, "utf-8")) as {
			defaultSessionKey: string | null;
			sessions: Record<string, unknown>;
		};
		expect(store.defaultSessionKey).toBeNull();
		expect(Object.keys(store.sessions)).toHaveLength(0);
	});

	it("rejects invalid mode", async () => {
		await expect(
			program.parseAsync([
				"node",
				"test",
				"harness",
				"spawn",
				"codex",
				"--mode",
				"bad-mode",
				"run",
			])
		).rejects.toThrow("process.exit(1)");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid mode")
		);
	});
});
