// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readStorageJson,
	removeStorageJson,
	writeStorageJson,
} from "../main-ipc/storage-json.js";

describe("atomic project JSON storage", () => {
	let directory: string;
	let filePath: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "qcut-storage-json-"));
		filePath = path.join(directory, "project.json");
		await fs.writeFile(filePath, JSON.stringify({ version: 0 }));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(directory, { recursive: true, force: true });
	});
	it("publishes complete JSON and keeps the old file readable until rename", async () => {
		const rename = fs.rename.bind(fs);
		vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
			expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
				version: 0,
			});
			expect(JSON.parse(await fs.readFile(from, "utf8"))).toEqual({
				version: 1,
			});
			await rename(from, to);
		});
		await writeStorageJson({ filePath, data: { version: 1 } });
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 1,
		});
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
	});
	it("preserves the previous file on partial writes and lets the next save succeed", async () => {
		const write = fs.writeFile.bind(fs);
		vi.spyOn(fs, "writeFile").mockImplementationOnce(async (target) => {
			await write(target, '{"version":');
			throw new Error("simulated interrupted write");
		});
		await expect(
			writeStorageJson({ filePath, data: { version: 1 } })
		).rejects.toThrow("interrupted write");
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 0,
		});
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
		await writeStorageJson({ filePath, data: { version: 2 } });
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 2,
		});
	});
	it("preserves the last published file and cleans up when rename fails", async () => {
		vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
		await expect(
			writeStorageJson({ filePath, data: { version: 1 } })
		).rejects.toThrow("rename failed");
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 0,
		});
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
	});
	it("serializes concurrent saves in invocation order", async () => {
		await Promise.all(
			Array.from({ length: 12 }, (_, version) =>
				writeStorageJson({ filePath, data: { version } })
			)
		);
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 11,
		});
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
	});
	it("lets a deletion overlap a pending save without resurrecting the project", async () => {
		// Hold the save inside rename so the deletion is requested while the write is in flight.
		const rename = fs.rename.bind(fs);
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
			await held;
			await rename(from, to);
		});
		const save = writeStorageJson({ filePath, data: { version: 1 } });
		const remove = removeStorageJson({ filePath });
		release();
		await Promise.all([save, remove]);
		await expect(fs.readFile(filePath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await fs.readdir(directory)).toEqual([]);
	});
	it("queues a save requested after a deletion", async () => {
		await removeStorageJson({ filePath });
		await writeStorageJson({ filePath, data: { version: 2 } });
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 2,
		});
	});
	it("treats deleting a missing project as done", async () => {
		await removeStorageJson({ filePath: path.join(directory, "absent.json") });
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
	});
	it("rejects unserializable values without touching the published file", async () => {
		await expect(
			writeStorageJson({ filePath, data: undefined })
		).rejects.toThrow("not JSON serializable");
		await expect(
			writeStorageJson({ filePath, data: { value: 1n } })
		).rejects.toThrow();
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({
			version: 0,
		});
	});
});

describe("reading stored project JSON", () => {
	let directory: string;
	let filePath: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "qcut-storage-read-"));
		filePath = path.join(directory, "project.json");
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("reads a value, and nothing for a missing or empty file", async () => {
		await fs.writeFile(filePath, '{"name":"a"}');
		expect(await readStorageJson({ filePath })).toEqual({
			value: { name: "a" },
		});
		await fs.writeFile(filePath, " \n");
		expect(await readStorageJson({ filePath })).toBeNull();
		expect(
			await readStorageJson({ filePath: path.join(directory, "absent.json") })
		).toBeNull();
	});

	it("reads the JSON before stray characters and keeps the file as it was", async () => {
		const damaged = '{"name":"Transition Parity","scenes":[{"id":"a"}]}}';
		await fs.writeFile(filePath, damaged);
		const read = await readStorageJson({ filePath });
		expect(read?.value).toEqual({
			name: "Transition Parity",
			scenes: [{ id: "a" }],
		});
		expect(read?.strayTail?.characters).toBe(1);
		const backupPath = read?.strayTail?.backupPath as string;
		expect(path.dirname(backupPath)).toBe(directory);
		expect(backupPath.endsWith(".json")).toBe(false);
		expect(await fs.readFile(backupPath, "utf8")).toBe(damaged);
		expect(await fs.readFile(filePath, "utf8")).toBe(damaged);
		await readStorageJson({ filePath });
		expect((await fs.readdir(directory)).sort()).toEqual(
			["project.json", path.basename(backupPath)].sort()
		);
	});

	it("reads the later of two overlapping saves that truncated the file", async () => {
		// Saves before 2026-09-27 wrote the file in place: both opened it
		// (truncating), the longer wrote, then the shorter wrote over its start.
		const longer = JSON.stringify({
			name: "Transition Parity - BT709 - 2026-08-01",
			scenes: [{ id: "main", name: "Main" }],
		});
		const shorter = JSON.stringify({
			name: "Transition Parity - BT709",
			scenes: [{ id: "main" }],
		});
		const first = await fs.open(filePath, "w");
		const second = await fs.open(filePath, "w");
		await first.write(longer, 0);
		await second.write(shorter, 0);
		await Promise.all([first.close(), second.close()]);
		const damaged = await fs.readFile(filePath, "utf8");
		expect(damaged).toBe(shorter + longer.slice(shorter.length));
		expect(() => JSON.parse(damaged)).toThrow(SyntaxError);
		const read = await readStorageJson({ filePath });
		expect(read?.value).toEqual(JSON.parse(shorter));
		expect(read?.strayTail?.characters).toBe(longer.length - shorter.length);
	});

	it("is not misled by braces and brackets inside strings", async () => {
		await fs.writeFile(filePath, '{"text":"a } b ] c \\" }"}x');
		expect((await readStorageJson({ filePath }))?.value).toEqual({
			text: 'a } b ] c " }',
		});
	});

	it.each([
		'{"name":',
		'x{"name":"a"}',
		'"name"x',
		'{"name":"a"]}',
	])("fails on other damage, without a copy: %s", async (contents) => {
		await fs.writeFile(filePath, contents);
		await expect(readStorageJson({ filePath })).rejects.toThrow(SyntaxError);
		expect(await fs.readdir(directory)).toEqual(["project.json"]);
	});

	it("does not read past the damage when the file cannot be copied aside", async () => {
		await fs.writeFile(filePath, '{"name":"a"}}');
		vi.spyOn(fs, "writeFile").mockRejectedValueOnce(
			Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
		);
		await expect(readStorageJson({ filePath })).rejects.toThrow(
			"could not be copied aside first (EACCES: permission denied)"
		);
		expect(await fs.readFile(filePath, "utf8")).toBe('{"name":"a"}}');
	});
});
