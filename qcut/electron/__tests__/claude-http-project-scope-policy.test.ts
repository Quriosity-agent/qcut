import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route that changes the project the editor has open must refuse a
 * request naming another project (`assertProjectIsOpen`, 409). A route may
 * skip the check only when it is listed here with the reason; a new mutating
 * `:projectId` route without the check fails this test.
 */
const EXEMPT: Record<string, string> = {
	"POST /api/claude/analyze/:projectId": "reads media files by project id",
	"POST /api/claude/transcribe/:projectId": "reads media files by project id",
	"POST /api/claude/transcribe/:projectId/start": "job over media files",
	"POST /api/claude/transcribe/:projectId/jobs/:jobId/cancel": "job id scoped",
	"POST /api/claude/analyze/:projectId/scenes": "reads media files",
	"POST /api/claude/analyze/:projectId/frames": "reads media files",
	"POST /api/claude/analyze/:projectId/fillers": "reads media files",
	"POST /api/claude/analyze/:projectId/beats": "reads media files",
	"POST /api/claude/analyze/:projectId/onset": "reads media files",
	"POST /api/claude/analyze/:projectId/suggest-cuts": "reads media files",
	"POST /api/claude/analyze/:projectId/suggest-cuts/start":
		"job over media files",
	"POST /api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId/cancel":
		"job id scoped",
	"POST /api/claude/timeline/:projectId/auto-edit/jobs/:jobId/cancel":
		"job id scoped",
	"POST /api/claude/generate/:projectId/start":
		"writes into the project folder",
	"POST /api/claude/generate/:projectId/jobs/:jobId/cancel": "job id scoped",
	"POST /api/claude/search/:projectId/index": "indexes the project's media",
	"POST /api/claude/media/:projectId/:mediaId/extract-frame":
		"reads a media file",
	"PATCH /api/claude/project/:projectId/settings":
		"settings bridge also serves closed projects",
	"POST /api/claude/project/:projectId/report": "reads project data",
	"POST /api/claude/export/:projectId/start":
		"compares the snapshot's projectId itself (409)",
	"POST /api/claude/export/:projectId/jobs/:jobId/cancel": "job id scoped",
};

function routeBodies(source: string) {
	const found: Array<{ key: string; body: string }> = [];
	const pattern =
		/router\.(post|patch|delete|put)\(\s*"([^"]*:projectId[^"]*)"/g;
	for (const match of source.matchAll(pattern)) {
		const start = match.index ?? 0;
		const open = source.indexOf("{", source.indexOf("=>", start));
		let depth = 0;
		let index = open;
		for (; index < source.length; index += 1) {
			if (source[index] === "{") depth += 1;
			else if (source[index] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		found.push({
			key: `${match[1].toUpperCase()} ${match[2]}`,
			body: source.slice(open, index),
		});
	}
	return found;
}

describe("project scope of mutating routes", () => {
	const dir = path.resolve(__dirname, "../claude/http");
	const files = readdirSync(dir).filter((name) => /routes.*\.ts$/.test(name));

	it("covers every route file", () => {
		expect(files.length).toBeGreaterThanOrEqual(4);
	});

	it("checks the open project on every mutating :projectId route not listed as exempt", () => {
		const unguarded: string[] = [];
		const seen = new Set<string>();
		for (const file of files) {
			const source = readFileSync(path.join(dir, file), "utf8");
			for (const route of routeBodies(source)) {
				seen.add(route.key);
				const guarded =
					route.body.includes("assertProjectIsOpen(") ||
					route.body.includes("assertProjectOpen(");
				if (!guarded && !(route.key in EXEMPT)) {
					unguarded.push(`${file}: ${route.key}`);
				}
			}
		}
		expect(unguarded).toEqual([]);
		// An exemption for a route that no longer exists is stale.
		for (const key of Object.keys(EXEMPT)) expect(seen).toContain(key);
	});
});
