import { createHash, randomUUID } from "node:crypto";
import {
	readFile,
	readdir,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import type { JianyingPortraitAdjustmentRenderResult } from "./jianying-portrait-adjustment-contract.js";
import { withPortraitRenderCacheLock } from "./render-disk-cache-lock.js";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const PORTRAIT_RENDER_CACHE_MAX_BYTES = 2 * 1024 ** 3;
const ENTRY_NAME = /^[a-f0-9]{64}\.frame$/;
const TEMPORARY_NAME = /^[a-f0-9]{64}\.frame\.[a-f0-9-]{36}\.tmp$/;
const HEADER_LIMIT = 4096;

function sha256({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function createPortraitRenderDiskCache({
	directory = process.env.QCUT_JIANYING_PORTRAIT_RENDER_CACHE_ROOT ??
		path.join(
			os.homedir(),
			"Library",
			"Caches",
			"QCut",
			"native-source-window-v1"
		),
	maxBytes = PORTRAIT_RENDER_CACHE_MAX_BYTES,
}: {
	directory?: string;
	maxBytes?: number;
} = {}) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error("Invalid native render cache capacity");
	let tail = Promise.resolve();
	let closed = false;
	let budgetChecked = false;
	function enqueue<Result>({
		run,
		signal,
	}: {
		run: () => Promise<Result>;
		signal?: AbortSignal;
	}) {
		if (closed)
			return Promise.reject(new Error("Native render cache is closed"));
		const operation = tail.then(() =>
			withPortraitRenderCacheLock({
				directory,
				signal,
				run: async () => {
					await removeOrphanedWrites();
					if (!budgetChecked) {
						await prune({ incoming: 0 });
						budgetChecked = true;
					}
					return run();
				},
			})
		);
		tail = operation.then(
			() => {},
			() => {}
		);
		return operation;
	}
	async function removeOrphanedWrites() {
		const names = await readdir(directory);
		// Every reader, writer and collector holds the same kernel lease.
		await Promise.all(
			names
				.filter((name) => TEMPORARY_NAME.test(name))
				.map((name) => rm(path.join(directory, name), { force: true }))
		);
	}
	function entryPath({ key }: { key: string }) {
		if (!/^[a-f0-9]{64}$/.test(key))
			throw new Error("Invalid native cache key");
		return path.join(directory, `${key}.frame`);
	}
	async function prune({
		incoming,
		keep,
	}: {
		incoming: number;
		keep?: string;
	}) {
		const names = await readdir(directory);
		const entries = await Promise.all(
			names
				.filter((name) => ENTRY_NAME.test(name))
				.map(async (name) => {
					const file = path.join(directory, name);
					const info = await stat(file).catch(() => null);
					return { file, size: info?.size ?? 0, touched: info?.mtimeMs ?? 0 };
				})
		);
		let total = entries.reduce((bytes, entry) => bytes + entry.size, incoming);
		await entries
			.sort(
				(left, right) =>
					Number(left.file === keep) - Number(right.file === keep) ||
					left.touched - right.touched
			)
			.reduce(async (previous, entry) => {
				await previous;
				if (total <= maxBytes) return;
				await rm(entry.file, { force: true });
				total -= entry.size;
			}, Promise.resolve());
		if (total > maxBytes)
			throw new Error("Native render cache exceeds capacity");
	}
	return {
		read: ({
			key,
			width,
			height,
			signal,
		}: {
			key: string;
			width: number;
			height: number;
			signal?: AbortSignal;
		}) =>
			enqueue({
				signal,
				run: async (): Promise<JianyingPortraitAdjustmentRenderResult | null> => {
					signal?.throwIfAborted();
					const file = entryPath({ key });
					const expectedBytes = width * height * 4;
					try {
						const info = await stat(file);
						if (
							info.size > maxBytes ||
							info.size > expectedBytes + HEADER_LIMIT + 65536
						)
							throw new Error("Invalid native cache entry size");
						const encoded = await readFile(file, { signal });
						signal?.throwIfAborted();
						const headerBytes = encoded.readUInt32BE(0);
						if (headerBytes < 1 || headerBytes > HEADER_LIMIT)
							throw new Error("Invalid native cache header");
						const header = JSON.parse(
							encoded.subarray(4, 4 + headerBytes).toString("utf8")
						) as {
							key?: string;
							width?: number;
							height?: number;
							sha256?: string;
							activeGroups?: unknown;
						};
						if (
							header.key !== key ||
							header.width !== width ||
							header.height !== height ||
							!Array.isArray(header.activeGroups) ||
							!header.activeGroups.every(
								(group) => group === "face" || group === "body"
							)
						)
							throw new Error("Native cache identity mismatch");
						const rgba = await decompress(encoded.subarray(4 + headerBytes), {
							maxOutputLength: expectedBytes,
						});
						signal?.throwIfAborted();
						if (
							rgba.length !== expectedBytes ||
							sha256({ bytes: rgba }) !== header.sha256
						)
							throw new Error("Native cache pixels are corrupt");
						await utimes(file, new Date(), new Date()).catch(() => {});
						signal?.throwIfAborted();
						return {
							provider: "jianying-local-swing-v1",
							width,
							height,
							rgba: new Uint8Array(rgba),
							activeGroups: header.activeGroups as ("face" | "body")[],
						};
					} catch (error) {
						if (signal?.aborted) throw error;
						if ((error as NodeJS.ErrnoException).code !== "ENOENT")
							await rm(file, { force: true }).catch(() => {});
						return null;
					}
				},
			}),
		write: ({
			key,
			result,
		}: {
			key: string;
			result: JianyingPortraitAdjustmentRenderResult;
		}) =>
			enqueue({
				run: async () => {
					if (result.needsSourcePreRoll) return;
					if (result.rgba.byteLength !== result.width * result.height * 4)
						throw new Error("Invalid native cache output");
					const file = entryPath({ key });
					const header = Buffer.from(
						JSON.stringify({
							key,
							width: result.width,
							height: result.height,
							sha256: sha256({ bytes: result.rgba }),
							activeGroups: result.activeGroups,
						})
					);
					const prefix = Buffer.alloc(4);
					prefix.writeUInt32BE(header.byteLength);
					const encoded = Buffer.concat([
						prefix,
						header,
						await compress(result.rgba, { level: 1 }),
					]);
					if (encoded.byteLength > maxBytes) return;
					await prune({ incoming: encoded.byteLength, keep: file });
					const temporary = `${file}.${randomUUID()}.tmp`;
					try {
						await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" });
						await rename(temporary, file);
					} finally {
						await rm(temporary, { force: true });
					}
				},
			}),
		close: async () => {
			closed = true;
			await tail;
		},
	};
}
