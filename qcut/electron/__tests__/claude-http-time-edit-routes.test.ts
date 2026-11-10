import { describe, expect, it, vi } from "vitest";
import { registerTimeEditRoutes } from "../claude/http/claude-http-time-edit-routes.js";
import type { Router } from "../claude/utils/http-router.js";

/**
 * `POST /timeline/:projectId/gap` and `/snap-to-frames`: what each hands the
 * editor, and what it refuses with 400, 409 or 503 before reaching it.
 */

type Handler = (req: {
	params: Record<string, string>;
	query: Record<string, string>;
	headers?: Record<string, string>;
	body?: unknown;
}) => Promise<unknown>;

function setup({
	openProjectId = "project-1",
	withEditor = true,
}: {
	openProjectId?: string;
	withEditor?: boolean;
} = {}) {
	const handlers = new Map<string, Handler>();
	const router = {
		post: (path: string, handler: Handler) => handlers.set(path, handler),
	} as unknown as Router;
	const requestTimeEdit = vi.fn(async (request: { operation: string }) => ({
		done: request.operation,
	}));
	registerTimeEditRoutes(router, {
		...(withEditor ? { requestTimeEdit: requestTimeEdit as never } : {}),
		requestStateSnapshot: (async () => ({
			version: 1,
			timestamp: 0,
			state: { project: { activeProject: { id: openProjectId } } },
		})) as never,
	});
	const call = (path: string, body: unknown, projectId = "project-1") =>
		(handlers.get(`/api/claude/timeline/:projectId/${path}`) as Handler)({
			params: { projectId },
			query: {},
			headers: {},
			body,
		});
	return { call, requestTimeEdit };
}

describe("POST /api/claude/timeline/:projectId/gap", () => {
	it("hands the editor the point, the length and the tracks", async () => {
		const { call, requestTimeEdit } = setup();
		expect(
			await call("gap", {
				time: 12.5,
				duration: 5,
				trackIds: [" main ", "titles"],
				keepAutomation: true,
			})
		).toEqual({ done: "insert-gap" });
		expect(requestTimeEdit.mock.calls[0][0]).toEqual({
			operation: "insert-gap",
			projectId: "project-1",
			time: 12.5,
			duration: 5,
			trackIds: ["main", "titles"],
			keepAutomation: true,
		});
	});

	it("leaves out what the request did not give", async () => {
		const { call, requestTimeEdit } = setup();
		await call("gap", { time: 0, duration: 5, trackIds: [] });
		expect(requestTimeEdit.mock.calls[0][0]).toEqual({
			operation: "insert-gap",
			projectId: "project-1",
			time: 0,
			duration: 5,
		});
	});

	it.each([
		[{ duration: 5 }, "time must be a number of seconds, 0 or more"],
		[{ time: -1, duration: 5 }, "time must be a number of seconds, 0 or more"],
		[{ time: "0", duration: 5 }, "time must be a number of seconds, 0 or more"],
		[{ time: 0 }, "duration must be a number of seconds above 0"],
		[{ time: 0, duration: 0 }, "duration must be a number of seconds above 0"],
		[
			{ time: 0, duration: 5, keepAutomation: "yes" },
			"keepAutomation must be true or false",
		],
		[
			{ time: 0, duration: 5, trackIds: "main" },
			"trackIds must be a list of ids",
		],
		[
			{ time: 0, duration: 5, trackIds: ["main", 2] },
			"trackIds must be a list of ids",
		],
	])("answers 400 for %j", async (body, message) => {
		const { call, requestTimeEdit } = setup();
		await expect(call("gap", body)).rejects.toMatchObject({
			status: 400,
			message,
		});
		expect(requestTimeEdit).not.toHaveBeenCalled();
	});

	it("answers 409 for a project that is not the open one, 503 without the editor", async () => {
		const other = setup({ openProjectId: "project-2" });
		await expect(
			other.call("gap", { time: 0, duration: 5 })
		).rejects.toMatchObject({ status: 409 });
		expect(other.requestTimeEdit).not.toHaveBeenCalled();
		await expect(
			setup({ withEditor: false }).call("gap", { time: 0, duration: 5 })
		).rejects.toMatchObject({ status: 503 });
	});
});

describe("POST /api/claude/timeline/:projectId/snap-to-frames", () => {
	it("snaps the clips that are seen on every track by default", async () => {
		const { call, requestTimeEdit } = setup();
		expect(await call("snap-to-frames", undefined)).toEqual({
			done: "snap-to-frames",
		});
		expect(requestTimeEdit.mock.calls[0][0]).toEqual({
			operation: "snap-to-frames",
			projectId: "project-1",
			frameAlign: "visual",
		});
	});

	it("passes the tracks, the clips, sound and a dry run through", async () => {
		const { call, requestTimeEdit } = setup();
		await call("snap-to-frames", {
			trackIds: ["main"],
			elementIds: ["a", "b"],
			frameAlign: "all",
			dryRun: true,
		});
		expect(requestTimeEdit.mock.calls[0][0]).toEqual({
			operation: "snap-to-frames",
			projectId: "project-1",
			trackIds: ["main"],
			elementIds: ["a", "b"],
			frameAlign: "all",
			dryRun: true,
		});
	});

	it("answers 400 for a frameAlign it does not have, or ids that are not ids, and 409 for another project", async () => {
		const { call, requestTimeEdit } = setup();
		await expect(
			call("snap-to-frames", { frameAlign: "none" })
		).rejects.toMatchObject({
			status: 400,
			message: "frameAlign must be visual or all",
		});
		await expect(
			call("snap-to-frames", { elementIds: [""] })
		).rejects.toMatchObject({
			status: 400,
			message: "elementIds must be a list of ids",
		});
		await expect(call("snap-to-frames", {}, "project-9")).rejects.toMatchObject(
			{ status: 409 }
		);
		expect(requestTimeEdit).not.toHaveBeenCalled();
	});
});
