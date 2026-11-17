import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/mock/Documents") },
	ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}));
vi.mock("electron-log", () => ({
	default: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}));

import {
	EXPORT_START_HTTP_TIMEOUT_MS,
	MEDIA_REFRESH_HTTP_TIMEOUT_MS,
	MEDIA_REFRESH_TIMEOUT_MS,
	MEDIA_RENAME_HTTP_TIMEOUT_MS,
	MEDIA_RENAME_TIMEOUT_MS,
} from "../claude/handlers/claude-media-deadlines.js";
import { JIANYING_PROJECT_EXPORT_ROUTE_PATH } from "../claude/http/claude-http-jianying-project-export-routes.js";
import {
	JIANYING_PROJECT_IMPORT_ROUTE_PATH,
	JIANYING_PROJECT_IMPORT_ROUTE_TIMEOUT_MS,
} from "../claude/http/claude-http-jianying-project-import-routes.js";
import { httpRequestTimeoutMs } from "../claude/http/claude-http-request-timeout.js";
import { TIMELINE_BATCH_HTTP_TIMEOUT_MS } from "../claude/utils/timeline-batch-deadline.js";

/** What each server gives a request that names no route of its own. */
const MAIN_SERVER_MS = 30_000;
const UTILITY_SERVER_MS = 120_000;

const REFRESH = "/api/claude/media/project-1/refresh";
const RENAME = "/api/claude/media/project-1/media_b2xkLm1wNA/rename";
const EXPORT_START = "/api/claude/export/project-1/start";

describe("the time one HTTP request has", () => {
	/**
	 * The main-process server ended every request after 30 s. A refresh
	 * waits up to 100 s for the editor and a rename 30 s: the 408 went out
	 * while the route was still at work, and its answer was dropped.
	 */
	it("outlasts what a media refresh, a media rename and an export start wait for", () => {
		const refresh = httpRequestTimeoutMs({
			path: REFRESH,
			usualMs: MAIN_SERVER_MS,
		});
		expect(refresh).toBe(MEDIA_REFRESH_HTTP_TIMEOUT_MS);
		expect(refresh).toBeGreaterThan(MEDIA_REFRESH_TIMEOUT_MS);

		const rename = httpRequestTimeoutMs({
			path: RENAME,
			usualMs: MAIN_SERVER_MS,
		});
		expect(rename).toBe(MEDIA_RENAME_HTTP_TIMEOUT_MS);
		expect(rename).toBeGreaterThan(MEDIA_RENAME_TIMEOUT_MS);

		expect(
			httpRequestTimeoutMs({ path: EXPORT_START, usualMs: MAIN_SERVER_MS })
		).toBe(EXPORT_START_HTTP_TIMEOUT_MS);
	});

	it("never gives a route less than the server's usual time", () => {
		for (const path of [REFRESH, RENAME, EXPORT_START]) {
			expect(httpRequestTimeoutMs({ path, usualMs: UTILITY_SERVER_MS })).toBe(
				UTILITY_SERVER_MS
			);
		}
	});

	it("leaves every other route as it was", () => {
		for (const usualMs of [MAIN_SERVER_MS, UTILITY_SERVER_MS]) {
			for (const path of [
				"/api/claude/health",
				"/api/claude/media/project-1",
				"/api/claude/media/project-1/media_b2xkLm1wNA",
				"/api/claude/export/project-1/jobs/job-1",
				"/api/claude/timeline/project-1",
			]) {
				expect(httpRequestTimeoutMs({ path, usualMs })).toBe(usualMs);
			}
			expect(
				httpRequestTimeoutMs({
					path: "/api/claude/timeline/project-1/elements/batch",
					usualMs,
				})
			).toBe(TIMELINE_BATCH_HTTP_TIMEOUT_MS);
			// A draft import or export has half an hour, and a minute on top.
			for (const path of [
				JIANYING_PROJECT_IMPORT_ROUTE_PATH,
				JIANYING_PROJECT_EXPORT_ROUTE_PATH,
			]) {
				expect(httpRequestTimeoutMs({ path, usualMs })).toBe(
					JIANYING_PROJECT_IMPORT_ROUTE_TIMEOUT_MS + 60_000
				);
			}
		}
	});
});
