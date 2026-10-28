/**
 * N13 (2026-10-28 trailer report): `delete-element` answered ok, and the
 * `timeline export` right after it still showed the element. A timeline read
 * that timed out stays queued in a busy editor; its late answer (the timeline
 * from before the delete) used to satisfy whichever read was waiting then,
 * because answers carried no request id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => {
	const listeners = new Map<
		string,
		Set<(event: unknown, data: unknown) => void>
	>();
	return {
		listeners,
		ipcMain: {
			on: (channel: string, fn: (event: unknown, data: unknown) => void) => {
				const set = listeners.get(channel) ?? new Set();
				set.add(fn);
				listeners.set(channel, set);
			},
			once: (channel: string, fn: (event: unknown, data: unknown) => void) => {
				const wrapped = (event: unknown, data: unknown) => {
					listeners.get(channel)?.delete(wrapped);
					fn(event, data);
				};
				const set = listeners.get(channel) ?? new Set();
				set.add(wrapped);
				listeners.set(channel, set);
			},
			removeListener: (
				channel: string,
				fn: (event: unknown, data: unknown) => void
			) => {
				listeners.get(channel)?.delete(fn);
			},
		},
		reply: (channel: string, data: unknown) => {
			for (const fn of [...(ipc.listeners.get(channel) ?? [])]) fn({}, data);
		},
	};
});

vi.mock("electron", () => ({ ipcMain: ipc.ipcMain, BrowserWindow: {} }));

import { requestTimelineFromRenderer } from "../claude/handlers/claude-timeline-operations.js";

/** An editor that answers in order once it is free, from its state then. */
function busyEditor() {
	const queue: Array<{ requestId: string }> = [];
	const state = { elements: ["old-score"] };
	return {
		state,
		queue,
		window: {
			isDestroyed: () => false,
			webContents: {
				isDestroyed: () => false,
				send: (_channel: string, data: { requestId: string }) => {
					queue.push(data);
				},
			},
		},
		/** The editor gets free: it answers every queued read in order. */
		drain() {
			for (const request of queue.splice(0)) {
				ipc.reply("claude:timeline:response", {
					requestId: request.requestId,
					timeline: {
						tracks: [{ id: "score", elements: [...state.elements] }],
					},
				});
			}
		},
	};
}

describe("timeline reads are matched to their own request", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("a late answer to a timed-out read does not satisfy a newer one", async () => {
		const editor = busyEditor();
		const win = editor.window as never;

		// A read while the editor is busy times out after 5 s…
		const stale = requestTimelineFromRenderer(win);
		const failed = expect(stale).rejects.toThrow(
			"Timeout waiting for timeline data"
		);
		await vi.advanceTimersByTimeAsync(5000);
		await failed;

		// …the element is deleted meanwhile, and a new read is made.
		editor.state.elements = [];
		const fresh = requestTimelineFromRenderer(win);
		// The editor answers the old read first (from before the delete is
		// visible to the new reader), then the new one.
		ipc.reply("claude:timeline:response", {
			requestId: editor.queue[0].requestId,
			timeline: { tracks: [{ id: "score", elements: ["old-score"] }] },
		});
		editor.queue.shift();
		editor.drain();

		await expect(fresh).resolves.toEqual({
			tracks: [{ id: "score", elements: [] }],
		});
		expect(ipc.listeners.get("claude:timeline:response")?.size ?? 0).toBe(0);
	});

	it("ignores an answer without an id", async () => {
		const editor = busyEditor();
		const read = requestTimelineFromRenderer(editor.window as never);
		ipc.reply("claude:timeline:response", { tracks: [] });
		editor.drain();
		await expect(read).resolves.toEqual({
			tracks: [{ id: "score", elements: ["old-score"] }],
		});
	});
});
