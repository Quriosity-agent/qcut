import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import { handleUpdatesCommand } from "../native-pipeline/editor/editor-handlers-updates";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client";
import { registerUpdateRoutes } from "../claude/http/claude-http-update-routes";
import { createRouter } from "../claude/utils/http-router";
import type { AutoUpdateController } from "../auto-update-controller";
import {
	getUpdateStatus,
	handleUpdateControlRequest,
	registerUpdateControl,
} from "../update-control";
import type { ClaudeUpdateStatus } from "../types/claude-api";

/**
 * N26 (2026-10-30 trailer report): `qcut editor updates pause` holds QCut's
 * own updates back while a project is under way; `resume` lets them go.
 */

const servers: Server[] = [];

afterEach(async () => {
	registerUpdateControl({ packageVersion: "" });
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve) => server.close(() => resolve()))
			)
	);
});

const pausedStatus: ClaudeUpdateStatus = {
	available: true,
	paused: true,
	automaticUpdates: true,
	phase: "ready",
	currentVersion: "2026.10.30.1",
	staged: "2026.10.30.2",
};

function fakeController(): AutoUpdateController {
	let paused = false;
	return {
		getState: () => ({
			phase: "ready",
			currentVersion: "2026.10.30.1",
			version: "2026.10.30.2",
			percent: 100,
			transferred: 0,
			total: 0,
			automaticDownload: false,
			paused,
			staged: { version: "2026.10.30.2", internalVersion: "2026.10.3002" },
		}),
		getPreferences: () => ({
			automaticUpdates: true,
			maxAutomaticDownloadBytes: 1,
			paused,
		}),
		setPreferences: ({ preferences }) => {
			paused = preferences.paused ?? paused;
			return { automaticUpdates: true, maxAutomaticDownloadBytes: 1, paused };
		},
	} as AutoUpdateController;
}

describe("editor updates commands", () => {
	it("parse as editor:updates:<action>", () => {
		expect(parseCliArgs(["editor", "updates", "pause"]).command).toBe(
			"editor:updates:pause"
		);
		expect(parseCliArgs(["editor:updates:status"]).command).toBe(
			"editor:updates:status"
		);
	});

	it("pause through the API and say what is held back", async () => {
		const post = vi.fn(async () => pausedStatus);
		const client = { post, get: vi.fn() } as unknown as EditorApiClient;
		const result = await handleUpdatesCommand(client, {
			command: "editor:updates:pause",
		} as never);
		expect(post).toHaveBeenCalledWith("/api/claude/updates/pause", {});
		expect(result).toEqual({
			success: true,
			data: {
				...pausedStatus,
				hint: "QCut 2026.10.30.2 is downloaded and stays uninstalled until: qcut editor updates resume",
			},
		});
	});
});

describe("update control in the main process", () => {
	it("says a development build does not update itself", () => {
		registerUpdateControl({ packageVersion: "2026.10.3001" });
		expect(getUpdateStatus()).toMatchObject({
			available: false,
			phase: "unavailable",
			currentVersion: "2026.10.30.1",
		});
		expect(() =>
			handleUpdateControlRequest({
				channel: "updates:set-paused",
				data: { paused: true },
			})
		).toThrow("does not update itself");
	});

	it("pauses the updater and answers with the downloaded version", () => {
		registerUpdateControl({
			updateController: fakeController(),
			packageVersion: "2026.10.3001",
		});
		expect(
			handleUpdateControlRequest({
				channel: "updates:set-paused",
				data: { paused: true },
			})
		).toEqual(pausedStatus);
		expect(
			handleUpdateControlRequest({ channel: "windows:list", data: {} })
		).toBeUndefined();
	});

	it("refuses pause over HTTP where nothing updates", async () => {
		const router = createRouter();
		const setPaused = vi.fn();
		registerUpdateRoutes(router, {
			getStatus: async () => ({ ...getUpdateStatus() }),
			setPaused,
		});
		const server = createServer((request, response) =>
			router.handle(request, response)
		);
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve)
		);
		const address = server.address() as { port: number };
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/claude/updates/pause`,
			{ method: "POST" }
		);
		expect(response.status).toBe(409);
		expect(setPaused).not.toHaveBeenCalled();
	});
});
