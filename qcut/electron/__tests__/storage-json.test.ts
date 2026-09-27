// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeStorageJson } from "../main-ipc/storage-json.js";

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
