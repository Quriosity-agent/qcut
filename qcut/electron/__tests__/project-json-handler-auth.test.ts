import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureClaudeApiToken } from "../claude/http/claude-api-token.js";
import { authorizeClaudeHttpRequest } from "../claude/http/claude-http-auth.js";
import { setupProjectJsonIPC } from "../project-json-handler.js";

const electron = vi.hoisted(() => ({
	documents: "",
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => electron.documents },
	ipcMain: {
		handle: (
			channel: string,
			handler: (...args: unknown[]) => Promise<unknown>
		) => {
			electron.handlers.set(channel, handler);
		},
	},
}));

const projectId = "snapshot-auth-test";
let server: Server;
let baseUrl: string;
let rejectSnapshotRequests: boolean;
let authenticatedRequestCount: number;

function snapshotPath(): string {
	return path.join(
		electron.documents,
		"QCut",
		"Projects",
		projectId,
		"project.json"
	);
}

function writeSnapshot(): Promise<unknown> {
	const handler = electron.handlers.get("project-json:write");
	if (!handler) throw new Error("Snapshot IPC handler was not registered");
	return handler({}, projectId);
}

beforeEach(async () => {
	electron.documents = await mkdtemp(
		path.join(tmpdir(), "qcut-snapshot-auth-")
	);
	vi.stubEnv("QCUT_API_TOKEN", undefined);
	rejectSnapshotRequests = false;
	authenticatedRequestCount = 0;
	setupProjectJsonIPC();
	server = createServer((req, res) => {
		const auth = authorizeClaudeHttpRequest({ req });
		res.setHeader("Content-Type", "application/json");
		if (!auth.ok || rejectSnapshotRequests) {
			res.writeHead(401);
			res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
			return;
		}
		authenticatedRequestCount += 1;
		let data: unknown = {};
		if (req.url?.endsWith("/settings")) {
			data = {
				name: "Authenticated snapshot",
				width: 1470,
				height: 630,
				fps: 24,
			};
		} else if (req.url?.endsWith("/stats")) {
			data = { elementCount: 32, trackCount: 1, totalDuration: 33.54 };
		} else if (req.url?.startsWith("/api/claude/media/")) {
			data = [];
		}
		res.end(JSON.stringify({ success: true, data }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing test server port");
	baseUrl = `http://127.0.0.1:${address.port}`;
	vi.stubEnv("QCUT_API_PORT", String(address.port));
});

afterEach(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
	await rm(electron.documents, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("project JSON internal authentication", () => {
	it.each([
		"generated",
		"configured with whitespace",
	])("writes a snapshot using a %s runtime token and dynamic port", async (tokenMode) => {
		const { token } = ensureClaudeApiToken();
		if (tokenMode === "configured with whitespace") {
			vi.stubEnv("QCUT_API_TOKEN", `  ${token}\n`);
		}
		const anonymous = await fetch(
			`${baseUrl}/api/claude/project/${projectId}/settings`
		);
		expect(anonymous.status).toBe(401);
		await expect(writeSnapshot()).resolves.toEqual({ ok: true });
		expect(authenticatedRequestCount).toBe(4);
		const text = await readFile(snapshotPath(), "utf8");
		expect(JSON.parse(text)).toMatchObject({
			projectId,
			name: "Authenticated snapshot",
			settings: { width: 1470, height: 630, fps: 24, elementCount: 32 },
		});
		expect(text).not.toContain(token);
	});

	it("retains the last snapshot if authenticated reads are rejected", async () => {
		ensureClaudeApiToken();
		await expect(writeSnapshot()).resolves.toEqual({ ok: true });
		const previous = '{"lastKnownGood":true}\n';
		await writeFile(snapshotPath(), previous);
		rejectSnapshotRequests = true;
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(writeSnapshot()).resolves.toEqual({ ok: false });
		expect(await readFile(snapshotPath(), "utf8")).toBe(previous);
	});
});
