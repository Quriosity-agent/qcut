import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMetaRoutes } from "../claude/http/claude-http-meta-routes.js";
import type { ParsedRequest, Router } from "../claude/utils/http-router.js";
import {
	noticeLastUpdate,
	resetUpdateNoticeForTests,
} from "../native-pipeline/editor/editor-update-notice.js";
import { recordLaunchVersion } from "../update-history.js";
import {
	formatLastUpdateHeader,
	parseLastUpdateHeader,
	type UpdateRecord,
} from "../update-notice.js";

/**
 * N26 (2026-10-30 trailer report): QCut updated itself to 2026.10.29.3
 * overnight, and an agent learned it only by measuring an export. A launch
 * now notes the version that ran before; health reports it and the CLI says
 * it once.
 */

const dirs: string[] = [];
function folder(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "qcut-update-history-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	resetUpdateNoticeForTests();
});

const UPDATE: UpdateRecord = {
	from: "2026.10.29.2",
	to: "2026.10.29.3",
	at: "2026-10-30T00:41:07.000Z",
	releaseNotes:
		"https://github.com/Quriosity-agent/qcut/releases/tag/v2026.10.29.3",
};

describe("the launch record", () => {
	it("names the update the first launch of a new version finds, and keeps it", () => {
		const userDataPath = folder();
		const launch = (packageVersion: string, at: string) =>
			recordLaunchVersion({ userDataPath, packageVersion, now: new Date(at) });
		// The first version to write the record cannot name the one before it.
		expect(launch("2026.10.2902", "2026-10-29T10:00:00Z")).toBeUndefined();
		expect(launch("2026.10.2902", "2026-10-29T18:00:00Z")).toBeUndefined();
		expect(launch("2026.10.2903", "2026-10-30T00:41:07Z")).toEqual(UPDATE);
		// Later launches of the same version still report that update.
		expect(launch("2026.10.2903", "2026-10-30T09:00:00Z")).toEqual(UPDATE);
		expect(
			JSON.parse(
				readFileSync(path.join(userDataPath, "update-history.json"), "utf8")
			)
		).toEqual({ lastRunVersion: "2026.10.29.3", lastUpdate: UPDATE });
	});

	it("drops a last update that is not one, keeping the version", () => {
		const userDataPath = folder();
		writeFileSync(
			path.join(userDataPath, "update-history.json"),
			JSON.stringify({
				lastRunVersion: "2026.10.29.3",
				lastUpdate: { from: 7, to: "2026.10.29.3" },
			})
		);
		expect(
			recordLaunchVersion({ userDataPath, packageVersion: "2026.10.2903" })
		).toBeUndefined();
	});

	it("starts over from a record it cannot read", () => {
		const userDataPath = folder();
		writeFileSync(path.join(userDataPath, "update-history.json"), "{not json");
		expect(
			recordLaunchVersion({ userDataPath, packageVersion: "2026.10.2903" })
		).toBeUndefined();
	});
});

describe("the update header and health", () => {
	it("round-trips the record through the header", () => {
		expect(parseLastUpdateHeader(formatLastUpdateHeader(UPDATE))).toEqual(
			UPDATE
		);
		// A hand-edited record still makes a header Node accepts.
		const odd = { ...UPDATE, from: "定版\n2026; x=1", releaseNotes: "a=b" };
		const header = formatLastUpdateHeader(odd);
		expect(header).toMatch(/^[\x21-\x7e ]+$/);
		expect(parseLastUpdateHeader(header)).toEqual(odd);
		expect(parseLastUpdateHeader("from=1; to=2")).toBeUndefined();
		expect(parseLastUpdateHeader(null)).toBeUndefined();
	});

	it("reports the release version and the last update", async () => {
		const routes = new Map<string, (req: ParsedRequest) => Promise<unknown>>();
		const record = (
			route: string,
			handler: (req: ParsedRequest) => Promise<unknown>
		) => routes.set(route, handler);
		const router = {
			get: record,
			post: record,
			patch: record,
			put: record,
			delete: record,
		} as unknown as Router;
		registerMetaRoutes({
			router,
			getAppVersion: () => "2026.10.2903",
			getLastUpdate: () => UPDATE,
		});
		const health = (await routes.get("/api/claude/health")?.({
			query: {},
		} as ParsedRequest)) as Record<string, unknown>;
		expect(health).toMatchObject({
			appVersion: "2026.10.2903",
			releaseVersion: "2026.10.29.3",
			lastUpdate: UPDATE,
		});
	});
});

describe("the CLI's notice", () => {
	it("says an update once, and again only for a new one", () => {
		const home = folder();
		vi.stubEnv("QCUT_CREDENTIALS_HOME", home);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const header = formatLastUpdateHeader(UPDATE);
		noticeLastUpdate(header);
		noticeLastUpdate(header);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toBe(
			"[QCut] QCut was updated from 2026.10.29.2 to 2026.10.29.3 (first run 2026-10-30T00:41:07.000Z). What changed: https://github.com/Quriosity-agent/qcut/releases/tag/v2026.10.29.3"
		);
		// The next CLI process has been told already.
		resetUpdateNoticeForTests();
		noticeLastUpdate(header);
		expect(warn).toHaveBeenCalledTimes(1);
		// A later update is new.
		resetUpdateNoticeForTests();
		noticeLastUpdate(
			formatLastUpdateHeader({
				...UPDATE,
				from: "2026.10.29.3",
				to: "2026.10.31.1",
				at: "2026-10-31T08:00:00.000Z",
			})
		);
		expect(warn).toHaveBeenCalledTimes(2);
		// Answers without the header say nothing.
		resetUpdateNoticeForTests();
		noticeLastUpdate(null);
		expect(warn).toHaveBeenCalledTimes(2);
	});
});
