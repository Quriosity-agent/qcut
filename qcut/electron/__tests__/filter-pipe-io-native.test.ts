// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	loadIndependentFogLut,
	resolveIndependentFogLut,
} from "../qcut-independent-filter/assets.js";
import { resolveIndependentFilterHost } from "../qcut-independent-filter/bridge.js";

function readResponse({
	child,
	size,
}: {
	child: ChildProcessWithoutNullStreams;
	size: number;
}) {
	return new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let length = 0;
		const cleanup = () => {
			clearTimeout(timer);
			child.stdout.off("data", receive);
			child.off("close", closed);
		};
		const closed = () => {
			cleanup();
			reject(new Error("Host closed during response"));
		};
		const receive = (chunk: Buffer) => {
			chunks.push(chunk);
			length += chunk.length;
			if (length < size) return;
			cleanup();
			if (length > size) {
				reject(new Error("Oversized response"));
				return;
			}
			resolve(Buffer.concat(chunks));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Response timeout"));
		}, 5000);
		child.stdout.on("data", receive);
		child.once("close", closed);
	});
}
function write({
	child,
	bytes,
}: {
	child: ChildProcessWithoutNullStreams;
	bytes: Uint8Array;
}) {
	return new Promise<void>((resolve, reject) =>
		child.stdin.write(bytes, (error) => (error ? reject(error) : resolve()))
	);
}

describe.skipIf(
	process.platform !== "darwin" ||
		process.env.QCUT_INDEPENDENT_METAL_TEST !== "1"
)("real Metal bulk pipe I/O", () => {
	let binary: string;
	let lut: Uint8Array;
	const running: {
		child: ChildProcessWithoutNullStreams;
		exited: Promise<number | null>;
	}[] = [];
	beforeAll(async () => {
		[binary, lut] = await Promise.all([
			resolveIndependentFilterHost(),
			resolveIndependentFogLut().then((filePath) =>
				loadIndependentFogLut({ filePath })
			),
		]);
	}, 120_000);
	afterEach(async () => {
		await Promise.all(
			running.splice(0).map(async ({ child, exited }) => {
				if (child.exitCode === null) child.kill("SIGKILL");
				await exited;
			})
		);
	});
	async function openHost({
		fragmentedLut = false,
	}: {
		fragmentedLut?: boolean;
	} = {}) {
		const child = spawn(binary, [], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				DYLD_LIBRARY_PATH: "",
				DYLD_INSERT_LIBRARIES: "",
				DYLD_FRAMEWORK_PATH: "",
			},
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("close", resolve);
			child.once("error", reject);
		});
		running.push({ child, exited });
		const ready = readResponse({ child, size: 4 });
		if (fragmentedLut) {
			await [
				lut.subarray(0, 3),
				lut.subarray(3, 1027),
				lut.subarray(1027),
			].reduce(async (previous, bytes) => {
				await previous;
				await write({ child, bytes });
			}, Promise.resolve());
		} else {
			await write({ child, bytes: lut });
		}
		expect((await ready).readUInt32LE()).toBe(0x51464d31);
		return { child, exited, stderr: () => stderr };
	}
	function header({ width, height }: { width: number; height: number }) {
		const bytes = Buffer.alloc(12);
		bytes.writeUInt32LE(width, 0);
		bytes.writeUInt32LE(height, 4);
		bytes.writeFloatLE(0, 8);
		return bytes;
	}

	it("reads fragmented LUT/header/pixels and handles output backpressure byte exactly", async () => {
		const { child, exited } = await openHost({ fragmentedLut: true });
		const width = 1920;
		const height = 1080;
		const pixels = Buffer.alloc(width * height * 4);
		for (let index = 0; index < pixels.length; index += 1)
			pixels[index] = index % 251;
		const frameHeader = header({ width, height });
		const response = readResponse({ child, size: pixels.length });
		child.stdout.pause();
		await [
			frameHeader.subarray(0, 3),
			frameHeader.subarray(3),
			pixels.subarray(0, 1027),
			pixels.subarray(1027),
		].reduce(async (previous, bytes) => {
			await previous;
			await write({ child, bytes });
		}, Promise.resolve());
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		child.stdout.resume();
		expect((await response).equals(pixels)).toBe(true);
		child.stdin.end();
		expect(await exited).toBe(0);
	});

	it("treats EOF between frames as a clean exit", async () => {
		const { child, exited } = await openHost();
		child.stdin.end();
		expect(await exited).toBe(0);
	});

	it.each(["header", "pixels"])("rejects EOF inside %s", async (part) => {
		const { child, exited, stderr } = await openHost();
		const bytes = header({ width: 3, height: 1 });
		child.stdin.end(
			part === "header"
				? bytes.subarray(0, 2)
				: Buffer.concat([bytes, Buffer.alloc(4)])
		);
		expect(await exited).toBe(1);
		expect(stderr()).toContain("Truncated input frame");
	});
});
