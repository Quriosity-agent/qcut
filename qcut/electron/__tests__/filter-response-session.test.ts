// @vitest-environment node
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createIndependentFilterSession,
	createIndependentFrameRequest,
	type IndependentFilterSession,
} from "../qcut-independent-filter/session.js";

const state = vi.hoisted(() => ({
	child: undefined as ChildProcessWithoutNullStreams | undefined,
}));
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: () => state.child,
}));
vi.mock("../qcut-independent-filter/bridge.js", () => ({
	resolveIndependentFilterHost: async () => "test-host",
}));
vi.mock("../qcut-independent-filter/assets.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../qcut-independent-filter/assets.js")
	>()),
	loadIndependentFogLut: async () => Buffer.alloc(4),
}));

function host({
	respond,
}: {
	respond: (frame: Buffer, stdout: PassThrough) => void;
}) {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const events = new EventEmitter();
	let initialized = false;
	const stdin = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			queueMicrotask(() => {
				if (initialized) respond(chunk, stdout);
				if (!initialized) {
					stdout.write(Buffer.from([0x31, 0x4d]));
					stdout.write(Buffer.from([0x46, 0x51]));
					initialized = true;
				}
				callback();
			});
		},
	});
	const kill = vi.fn(() => {
		queueMicrotask(() => events.emit("close", null));
		return true;
	});
	state.child = Object.assign(events, {
		stdin,
		stdout,
		stderr,
		kill,
	}) as unknown as ChildProcessWithoutNullStreams;
	return { stdout, kill };
}

const sessions: IndependentFilterSession[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	state.child = undefined;
});
async function openSession() {
	const session = await createIndependentFilterSession({ lutPath: "test-lut" });
	sessions.push(session);
	return session;
}
function request() {
	return createIndependentFrameRequest({
		width: 3,
		height: 1,
		intensity: 0,
		rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 0]),
	});
}

describe("Metal response stream lifecycle", () => {
	it("reassembles fragmented readiness and pixels across queued frames", async () => {
		host({
			respond: (frame, stdout) => {
				const pixels = frame.subarray(12);
				for (let index = 0; index < pixels.length; index += 1)
					stdout.write(pixels.subarray(index, index + 1));
			},
		});
		const session = await openSession();
		const frames = await Promise.all([
			session.render(request()),
			session.render(request()),
		]);
		expect(frames.map((frame) => frame.rgba)).toEqual([
			request().rgba,
			request().rgba,
		]);
	});

	it("rejects an overflowing response and keeps the failed session closed", async () => {
		const child = host({
			respond: (_frame, stdout) =>
				stdout.emit("data", Buffer.alloc(1920 * 1080 * 4 + 5)),
		});
		const session = await openSession();
		await expect(session.render(request())).rejects.toThrow(
			"Invalid Metal frame response"
		);
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
		await expect(session.render(request())).rejects.toThrow(
			"Invalid Metal frame response"
		);
	});

	it("rejects a partial frame on disposal and ignores late chunks", async () => {
		let received: (() => void) | undefined;
		const written = new Promise<void>((resolve) => {
			received = resolve;
		});
		const child = host({
			respond: (_frame, stdout) => {
				stdout.write(Buffer.from([1, 2]));
				received?.();
			},
		});
		const session = await openSession();
		const rendered = expect(session.render(request())).rejects.toThrow(
			"disposed"
		);
		await written;
		await session.dispose();
		child.stdout.emit("data", Buffer.alloc(1920 * 1080 * 4 + 5));
		await rendered;
		await expect(session.render(request())).rejects.toThrow("disposed");
	});
});
