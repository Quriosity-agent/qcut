import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineApplyManifest } from "../native-pipeline/editor/editor-timeline-apply.js";
import {
	MAX_TRANSACTION_TIMEOUT_MS,
	applyTransactionTimeoutMs,
	timelineFingerprint,
} from "../native-pipeline/editor/editor-timeline-apply-transaction.js";

const BEFORE = {
	tracks: [
		{
			id: "main-track",
			index: 0,
			name: "Main Track",
			type: "media",
			isMain: true,
			elements: [{ id: "old-clip", startTime: 0, duration: 4 }],
		},
	],
};

const manifest = {
	replace: true,
	tracks: [
		{
			alias: "main",
			name: "Main",
			type: "media",
			elements: [
				{
					alias: "shot-1",
					type: "media",
					mediaId: "media-1",
					startTime: 0,
					duration: 2,
				},
			],
		},
		{ alias: "titles", name: "Titles", type: "text", elements: [] },
	],
};

function options(): CLIRunOptions {
	return {
		command: "editor:timeline:apply",
		projectId: "project-1",
		manifest: JSON.stringify(manifest),
		atomic: true,
		verify: true,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
	} as CLIRunOptions;
}

/**
 * An editor whose transaction QCut ended while the apply was still adding
 * clips: the batch meets a track that is gone, and the rollback is refused
 * because the transaction is no longer active.
 */
function editorWhoseTransactionExpired({
	timelineAfter,
	transaction,
}: {
	timelineAfter: unknown;
	transaction: Record<string, unknown> | Error;
}) {
	let timelineReads = 0;
	const get = vi.fn(async (url: string) => {
		if (url === "/api/claude/navigator/projects") {
			return { activeProjectId: "project-1", projects: [] };
		}
		if (url === "/api/claude/media/project-1") return [];
		if (url === "/api/claude/timeline/project-1") {
			timelineReads += 1;
			// Readiness and the read before the apply see the old timeline.
			return structuredClone(timelineReads <= 2 ? BEFORE : timelineAfter);
		}
		if (url === "/api/claude/transaction/transaction-1") {
			if (transaction instanceof Error) throw transaction;
			return transaction;
		}
		throw new Error(`Unexpected GET ${url}`);
	});
	const post = vi.fn(async (url: string, _body?: unknown) => {
		if (url === "/api/claude/navigator/open") return { navigated: true };
		if (url === "/api/claude/transaction/begin") {
			return { transactionId: "transaction-1" };
		}
		if (url === "/api/claude/timeline/project-1/tracks") {
			return { trackId: "titles-track" };
		}
		if (url === "/api/claude/timeline/project-1/elements/batch") {
			return {
				added: [
					{
						index: 0,
						success: false,
						error: "Track not found: main-track",
					},
				],
				failedCount: 1,
			};
		}
		if (url.endsWith("/rollback")) {
			throw new Error("Transaction is not active: transaction-1");
		}
		throw new Error(`Unexpected POST ${url}`);
	});
	const client = {
		get,
		post,
		patch: vi.fn(async () => ({})),
		delete: vi.fn(async () => ({ failedCount: 0 })),
	} as unknown as EditorApiClient;
	return { client, get, post };
}

describe("the transaction around timeline apply", () => {
	it("allows a small manifest a minute and a programme-length one QCut's cap", () => {
		const small = applyTransactionTimeoutMs({ manifest });
		expect(small).toBeGreaterThanOrEqual(60_000);
		expect(small).toBeLessThan(70_000);

		const cube = { size: 18, values: new Array(18 ** 3 * 3).fill(0.123456) };
		const programme = {
			tracks: Array.from({ length: 30 }, (_, track) => ({
				name: `Track ${track}`,
				type: "media",
				elements: Array.from({ length: 7 }, (_, index) => ({
					type: "media",
					mediaId: "media-1",
					startTime: index,
					duration: 1,
					color: { lut: { enabled: true, cube } },
				})),
			})),
		};
		expect(applyTransactionTimeoutMs({ manifest: programme })).toBe(
			MAX_TRANSACTION_TIMEOUT_MS
		);
	});

	it("asks QCut for a transaction that lasts as long as the manifest needs", async () => {
		const { client, post } = editorWhoseTransactionExpired({
			timelineAfter: BEFORE,
			transaction: { state: "timedOut", error: "Timed out after 61000ms" },
		});
		await timelineApplyManifest(client, options());
		const begin = post.mock.calls.find(
			([url]) => url === "/api/claude/transaction/begin"
		);
		expect(begin?.[1]).toEqual({
			label: "Apply timeline manifest",
			timeoutMs: applyTransactionTimeoutMs({ manifest }),
		});
	});

	it("reports rolledBack when QCut's timeout already put the timeline back", async () => {
		const { client } = editorWhoseTransactionExpired({
			timelineAfter: BEFORE,
			transaction: { state: "timedOut", error: "Timed out after 61000ms" },
		});
		const result = await timelineApplyManifest(client, options());
		expect(result.success).toBe(false);
		expect(result.data).toMatchObject({
			rolledBack: true,
			rollback: {
				by: "timeout",
				transactionState: "timedOut",
				timelineMatchesBefore: true,
			},
		});
		expect(result.error).toMatch(/^The apply ran past its \d+ s timeline/);
		expect(result.error).toContain("rolled the timeline back");
		expect(result.error).toContain("Track not found: main-track");
	});

	it("does not claim a rollback when the timeline is not what it was", async () => {
		const withStrayTrack = {
			tracks: [
				...BEFORE.tracks,
				{
					id: "titles-track",
					index: 1,
					name: "Titles",
					type: "text",
					elements: [],
				},
			],
		};
		const { client } = editorWhoseTransactionExpired({
			timelineAfter: withStrayTrack,
			transaction: {
				state: "timedOut",
				error: "Timeout waiting for transaction rollback",
			},
		});
		const result = await timelineApplyManifest(client, options());
		expect(result.data).toMatchObject({
			rolledBack: false,
			rollback: {
				by: "none",
				transactionState: "timedOut",
				timelineMatchesBefore: false,
				detail: "Timeout waiting for transaction rollback",
			},
		});
		expect(result.error).toContain("could not be confirmed as rolled back");
	});

	it("does not take unchanged ids for an unchanged timeline", async () => {
		// An apply that only patched a clip leaves every id where it was.
		const sameIdsOtherContents = structuredClone(BEFORE);
		sameIdsOtherContents.tracks[0].elements[0].duration = 2;
		const { client } = editorWhoseTransactionExpired({
			timelineAfter: sameIdsOtherContents,
			transaction: {
				state: "timedOut",
				error: "Timeout waiting for transaction rollback",
			},
		});
		const result = await timelineApplyManifest(client, options());
		expect(result.data).toMatchObject({
			rolledBack: false,
			rollback: { by: "none", timelineMatchesBefore: false },
		});
	});

	it("reads the same timeline as the same whatever it reports about a file's alpha", () => {
		const withAlpha = structuredClone(BEFORE) as typeof BEFORE & {
			tracks: Array<{ elements: Array<Record<string, unknown>> }>;
		};
		withAlpha.tracks[0].elements[0].hasAlpha = true;
		expect(timelineFingerprint({ timeline: withAlpha })).toBe(
			timelineFingerprint({ timeline: BEFORE })
		);
		const retimed = structuredClone(BEFORE);
		retimed.tracks[0].elements[0].startTime = 1;
		expect(timelineFingerprint({ timeline: retimed })).not.toBe(
			timelineFingerprint({ timeline: BEFORE })
		);
		const recoloured = structuredClone(BEFORE) as typeof BEFORE & {
			tracks: Array<Record<string, unknown>>;
		};
		recoloured.tracks[0].colorLabel = "red";
		expect(timelineFingerprint({ timeline: recoloured })).not.toBe(
			timelineFingerprint({ timeline: BEFORE })
		);
	});

	it("says how to end a transaction QCut still holds", async () => {
		const { client } = editorWhoseTransactionExpired({
			timelineAfter: BEFORE,
			transaction: { state: "active" },
		});
		const result = await timelineApplyManifest(client, options());
		expect(result.data).toMatchObject({
			rolledBack: false,
			rollback: { by: "none", transactionState: "active" },
		});
		expect(
			(result.data as { rollback: { detail: string } }).rollback.detail
		).toContain(
			"qcut editor transaction rollback --transaction-id transaction-1"
		);
		expect(result.error).toBe(
			"Element batch failed: Element 'shot-1' failed: Track not found: main-track"
		);
	});

	it("keeps the plain outcome when its own rollback is accepted", async () => {
		const { client, post } = editorWhoseTransactionExpired({
			timelineAfter: BEFORE,
			transaction: { state: "rolledBack" },
		});
		post.mockImplementation(async (url: string) => {
			if (url === "/api/claude/navigator/open") return { navigated: true };
			if (url === "/api/claude/transaction/begin") {
				return { transactionId: "transaction-1" };
			}
			if (url === "/api/claude/timeline/project-1/tracks") {
				return { trackId: "titles-track" };
			}
			if (url === "/api/claude/timeline/project-1/elements/batch") {
				return {
					added: [{ index: 0, success: false, error: "No such media" }],
					failedCount: 1,
				};
			}
			if (url.endsWith("/rollback")) return { rolledBack: true };
			throw new Error(`Unexpected POST ${url}`);
		});
		const result = await timelineApplyManifest(client, options());
		expect(result.data).toMatchObject({
			rolledBack: true,
			rollback: { by: "requested", transactionState: "rolledBack" },
		});
		expect(result.error).toBe(
			"Element batch failed: Element 'shot-1' failed: No such media"
		);
	});
});
