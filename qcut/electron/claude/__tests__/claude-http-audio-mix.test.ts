import { describe, expect, it, vi } from "vitest";
import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
	ClaudeAudioMixSnapshot,
} from "../../types/claude-audio-mix-api";
import {
	readBusPatch,
	readNewBusId,
	readTrackAudioPatch,
} from "../http/audio-mix-request";
import { registerAudioMixRoutes } from "../http/claude-http-audio-mix-routes";
import type { ParsedRequest, Router } from "../utils/http-router";
import { HttpError } from "../utils/http-router";

/** The mixer routes and the checks they run before the editor sees a change. */

function status(run: () => unknown): number | undefined {
	try {
		run();
	} catch (error) {
		return error instanceof HttpError ? error.status : -1;
	}
	return undefined;
}

function message(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "";
}

describe("mixer request checks", () => {
	it("passes a track change through exactly", () => {
		expect(
			readTrackAudioPatch({
				gainDb: -6,
				pan: 0.25,
				busId: " sfx ",
				solo: true,
				ducking: { enabled: true, sourceTrackIds: ["guns"], reductionDb: -6 },
				effects: {
					compressor: { enabled: true, ratio: 4 },
					parametricEqualizer: { bands: [{ id: "low", gainDb: -3 }] },
				},
			})
		).toEqual({
			gainDb: -6,
			pan: 0.25,
			busId: "sfx",
			solo: true,
			ducking: { enabled: true, sourceTrackIds: ["guns"], reductionDb: -6 },
			effects: {
				compressor: { enabled: true, ratio: 4 },
				parametricEqualizer: { bands: [{ id: "low", gainDb: -3 }] },
			},
		});
	});

	it("refuses values outside what the editor keeps instead of clamping them", () => {
		expect(message(() => readTrackAudioPatch({ gainDb: 20 }))).toBe(
			"gainDb must be between -60 and 12 (got 20)"
		);
		expect(status(() => readTrackAudioPatch({ pan: -2 }))).toBe(400);
		expect(
			message(() =>
				readTrackAudioPatch({ effects: { compressor: { ratio: 40 } } })
			)
		).toBe("effects.compressor.ratio must be between 1 and 20 (got 40)");
		expect(
			message(() => readTrackAudioPatch({ ducking: { reductionDb: 6 } }))
		).toBe("ducking.reductionDb must be between -60 and 0 (got 6)");
	});

	it("names unknown fields, at any depth", () => {
		expect(message(() => readTrackAudioPatch({ gain_db: -6 }))).toContain(
			"Unknown field gain_db; allowed: gainDb, pan, busId"
		);
		expect(
			message(() =>
				readTrackAudioPatch({ effects: { limiter: { ceiling: -1 } } })
			)
		).toContain("Unknown field effects.limiter.ceiling");
		expect(
			message(() =>
				readTrackAudioPatch({
					effects: { parametricEqualizer: { bands: [{ type: "peak" }] } },
				})
			)
		).toBe(
			"effects.parametricEqualizer.bands[0].type must be one of: bell, low-shelf, high-shelf, notch"
		);
	});

	it("refuses an empty change and non-numbers", () => {
		expect(message(() => readTrackAudioPatch({}))).toContain(
			"Nothing to change"
		);
		expect(message(() => readTrackAudioPatch({ gainDb: "-6" }))).toBe(
			"gainDb must be a number"
		);
		expect(message(() => readTrackAudioPatch({ muted: "yes" }))).toBe(
			"muted must be true or false"
		);
	});

	it("needs a name for a new bus, and a safe id that is not master", () => {
		expect(
			message(() => readBusPatch({ gainDb: -3 }, { creating: true }))
		).toBe("A new bus needs a name");
		expect(
			readBusPatch({ name: " SFX ", id: "sfx" }, { creating: true })
		).toEqual({ name: "SFX" });
		expect(readNewBusId({ id: "sfx_1" })).toBe("sfx_1");
		expect(status(() => readNewBusId({ id: "master" }))).toBe(400);
		expect(status(() => readNewBusId({ id: "硬音效" }))).toBe(400);
		expect(status(() => readBusPatch({ id: "sfx", name: "x" }))).toBe(400);
	});
});

function routes(
	mutateAudioMix?: (
		request: ClaudeAudioMixRequest
	) => Promise<ClaudeAudioMixResponse>
) {
	const handlers = new Map<string, (req: ParsedRequest) => Promise<unknown>>();
	const add =
		(method: string) =>
		(path: string, handler: (req: ParsedRequest) => Promise<unknown>) => {
			handlers.set(`${method} ${path}`, handler);
		};
	const router = {
		get: add("GET"),
		post: add("POST"),
		patch: add("PATCH"),
		delete: add("DELETE"),
	} as unknown as Router;
	const onChanged = vi.fn();
	registerAudioMixRoutes({ router, mutateAudioMix, onChanged });
	const call = (
		key: string,
		params: Record<string, string>,
		body?: unknown
	) => {
		const handler = handlers.get(key);
		if (!handler) throw new Error(`No route ${key}`);
		return handler({ params, query: {}, body } as ParsedRequest);
	};
	return { call, onChanged };
}

const snapshot: ClaudeAudioMixSnapshot = {
	projectId: "p",
	master: {
		id: "master",
		name: "Master",
		gainDb: -1,
		pan: 0,
		muted: false,
		solo: false,
		effects: {} as never,
	},
	buses: [],
	tracks: [
		{
			trackId: "guns",
			name: "SFX · Guns",
			type: "audio",
			muted: false,
			audio: { gainDb: -6 } as never,
			effective: { silenced: false, busId: "master" },
		},
	],
};

describe("mixer routes", () => {
	it("sends a checked track change to the editor and answers with the track read back", async () => {
		const mutate = vi.fn(async () => ({ success: true, mix: snapshot }));
		const { call, onChanged } = routes(mutate);

		const result = await call(
			"PATCH /api/claude/mix/:projectId/tracks/:trackId",
			{ projectId: "p", trackId: "guns" },
			{ gainDb: -6 }
		);

		expect(mutate).toHaveBeenCalledWith(
			{
				action: "set-track",
				projectId: "p",
				trackId: "guns",
				patch: { gainDb: -6 },
			},
			undefined
		);
		expect(result).toEqual({ track: snapshot.tracks[0], mix: snapshot });
		expect(onChanged).toHaveBeenCalledWith({ projectId: "p" });
	});

	it("reads the mix without marking the project changed", async () => {
		const { call, onChanged } = routes(async () => ({
			success: true,
			mix: snapshot,
		}));
		expect(
			await call("GET /api/claude/mix/:projectId", { projectId: "p" })
		).toEqual(snapshot);
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("turns the editor's refusals into matching statuses", async () => {
		const refusing = (reason: ClaudeAudioMixResponse["reason"]) =>
			routes(async () => ({
				success: false,
				reason,
				error: `refused: ${reason}`,
			}));
		for (const [reason, code] of [
			["not-open", 409],
			["not-found", 404],
			["invalid", 400],
		] as const) {
			const { call, onChanged } = refusing(reason);
			await expect(
				call("DELETE /api/claude/mix/:projectId/buses/:busId", {
					projectId: "p",
					busId: "sfx",
				})
			).rejects.toMatchObject({ status: code, message: `refused: ${reason}` });
			expect(onChanged).not.toHaveBeenCalled();
		}
	});

	it("creates a bus with the id asked for and answers with it", async () => {
		const created = {
			...snapshot,
			buses: [{ ...snapshot.master, id: "sfx", name: "SFX", gainDb: 0 }],
		};
		const mutate = vi.fn(async () => ({
			success: true,
			busId: "sfx",
			mix: created,
		}));
		const { call } = routes(mutate);
		const result = await call(
			"POST /api/claude/mix/:projectId/buses",
			{ projectId: "p" },
			{ id: "sfx", name: "SFX" }
		);
		expect(mutate).toHaveBeenCalledWith(
			{
				action: "create-bus",
				projectId: "p",
				busId: "sfx",
				bus: { name: "SFX" },
			},
			undefined
		);
		expect(result).toMatchObject({ busId: "sfx", bus: { id: "sfx" } });
	});

	it("says the mixer is unavailable when the editor cannot reach it", async () => {
		const { call } = routes(undefined);
		await expect(
			call("GET /api/claude/mix/:projectId", { projectId: "p" })
		).rejects.toMatchObject({ status: 503 });
	});
});
