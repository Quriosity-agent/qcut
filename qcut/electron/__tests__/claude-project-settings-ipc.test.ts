import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
	documents: "",
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
	send: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => electron.documents) },
	ipcMain: {
		handle: vi.fn(
			(channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
				electron.handlers.set(channel, handler);
			}
		),
		on: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => [{ webContents: { send: electron.send } }]),
		fromWebContents: vi.fn(() => null),
	},
}));

electron.documents = mkdtempSync(path.join(tmpdir(), "qcut-settings-ipc-"));
const { setupClaudeProjectIPC } = await import(
	"../claude/handlers/claude-project-handler.js"
);

function updateSettings(...args: unknown[]): Promise<unknown> {
	const handler = electron.handlers.get("claude:project:updateSettings");
	if (!handler) throw new Error("updateSettings handler was not registered");
	return handler({}, ...args);
}

function storedProject(projectId: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(
			path.join(
				electron.documents,
				"QCut",
				"Projects",
				projectId,
				"project.qcut"
			),
			"utf-8"
		)
	);
}

describe("claude:project:updateSettings", () => {
	setupClaudeProjectIPC();

	beforeEach(() => electron.send.mockClear());
	afterAll(() => rmSync(electron.documents, { recursive: true, force: true }));

	it("writes project.qcut and tells the editor", async () => {
		await updateSettings("p1", { width: 1280, height: 720, fps: 24 });

		expect(storedProject("p1")).toMatchObject({
			width: 1280,
			height: 720,
			fps: 24,
		});
		expect(electron.send).toHaveBeenCalledWith(
			"claude:project:updated",
			"p1",
			expect.objectContaining({ width: 1280, height: 720, fps: 24 })
		);
	});

	it("does not echo a change the editor mirrored itself", async () => {
		await updateSettings(
			"p2",
			{ width: 1080, height: 1920 },
			{ broadcast: false }
		);

		expect(storedProject("p2")).toMatchObject({ width: 1080, height: 1920 });
		expect(electron.send).not.toHaveBeenCalled();
	});
});
