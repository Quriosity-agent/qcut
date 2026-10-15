// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateFilterLabMediaFiles } from "../native-pipeline/cli/filter-lab-media-command.js";

const files = vi.hoisted(() => ({
	source: { dev: 7n, ino: 9_007_199_254_740_992n },
	destination: { dev: 7n, ino: 9_007_199_254_740_993n },
}));

vi.mock("node:fs/promises", () => {
	function fileStat({
		identity,
		options,
	}: {
		identity: { dev: bigint; ino: bigint };
		options?: { bigint?: boolean };
	}) {
		return {
			dev: options?.bigint ? identity.dev : Number(identity.dev),
			ino: options?.bigint ? identity.ino : Number(identity.ino),
			isFile: () => true,
		};
	}
	return {
		stat: vi.fn(async (_path: string, options?: { bigint?: boolean }) =>
			fileStat({ identity: files.source, options })
		),
		lstat: vi.fn(async (_path: string, options?: { bigint?: boolean }) =>
			fileStat({ identity: files.destination, options })
		),
	};
});

beforeEach(() => {
	files.destination = { dev: 7n, ino: 9_007_199_254_740_993n };
});

describe("filter-lab file identity", () => {
	it("requires force for distinct files whose 64-bit inodes round to the same Number", async () => {
		expect(files.source.ino).not.toBe(files.destination.ino);
		expect(Number(files.source.ino)).toBe(Number(files.destination.ino));
		await expect(
			validateFilterLabMediaFiles({
				input: "input.png",
				output: "output.png",
				force: false,
			})
		).rejects.toThrow("--force");
	});

	it("allows forced replacement of distinct files with rounded inode collisions", async () => {
		await expect(
			validateFilterLabMediaFiles({
				input: "input.png",
				output: "output.png",
				force: true,
			})
		).resolves.toBeUndefined();
	});

	it("still rejects a hard link to the source even with force", async () => {
		files.destination = { ...files.source };
		await expect(
			validateFilterLabMediaFiles({
				input: "input.png",
				output: "alias.png",
				force: true,
			})
		).rejects.toThrow("cannot overwrite the input");
	});

	it("allows the same inode on a different device", async () => {
		files.destination = { dev: 8n, ino: files.source.ino };
		await expect(
			validateFilterLabMediaFiles({
				input: "input.png",
				output: "output.png",
				force: true,
			})
		).resolves.toBeUndefined();
	});
});
