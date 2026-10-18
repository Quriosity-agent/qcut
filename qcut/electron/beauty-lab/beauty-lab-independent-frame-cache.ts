import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { z } from "zod";
import {
	type IndependentManualBody,
	independentManualBodyKeyEntries,
} from "./beauty-lab-independent-manual-body.js";

export const INDEPENDENT_FRAME_CACHE_MAX_BYTES = 4 * 1024 ** 3;

const sha256 = ({ bytes }: { bytes: Uint8Array | string }) =>
	createHash("sha256").update(bytes).digest("hex");

const entrySchema = z
	.object({
		schemaVersion: z.literal(1),
		key: z.string().regex(/^[a-f0-9]{64}$/),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		pngSha256: z.string().regex(/^[a-f0-9]{64}$/),
		rgbaSha256: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();

/**
 * Everything that decides an independent frame: the engine build, the frame
 * size, the adjustments, input pixels and ordered source evidence. Keys are sorted so
 * equal edits hash equally whatever order the UI wrote them in.
 */
export function independentFrameCacheKey({
	engineSha256,
	width,
	height,
	values,
	makeup,
	manualBody,
	rgba,
	sourceEvidenceSha256,
	sequence,
}: {
	engineSha256: string;
	width: number;
	height: number;
	values: Record<string, number>;
	makeup: Record<string, { cardId: string; intensity: number }>;
	/** Canonical (active tools only); absent keeps keys without manual body unchanged. */
	manualBody?: IndependentManualBody;
	rgba: Uint8Array;
	sourceEvidenceSha256?: string;
	/** A body-video frame: its session and frame index; absent keeps still-frame keys unchanged. */
	sequence?: { session: string; frame: number };
}) {
	const sorted = <T>(record: Record<string, T>) =>
		Object.entries(record).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		);
	return createHash("sha256")
		.update(
			JSON.stringify({
				schemaVersion: 1,
				engineSha256,
				width,
				height,
				sourceEvidenceSha256,
				values: sorted(values),
				makeup: sorted(makeup).map(([category, selection]) => [
					category,
					selection.cardId,
					selection.intensity,
				]),
				...(manualBody && Object.keys(manualBody).length > 0
					? { manualBody: independentManualBodyKeyEntries({ manualBody }) }
					: {}),
				...(sequence ? { sequence: [sequence.session, sequence.frame] } : {}),
			})
		)
		.update("\0")
		.update(rgba)
		.digest("hex");
}

async function decodePng({
	png,
	width,
	height,
}: {
	png: Uint8Array;
	width: number;
	height: number;
}) {
	const image = await loadImage(Buffer.from(png));
	if (image.width !== width || image.height !== height)
		throw new Error("Cached independent frame has other dimensions");
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	return new Uint8Array(context.getImageData(0, 0, width, height).data);
}

/**
 * Disk cache of processed independent frames. The engine needs seconds per
 * frame, so re-exporting an unchanged timeline, or returning to a
 * frame already processed while paused, reads the stored output instead.
 * Least recently used entries are evicted once the cache passes `maxBytes`.
 */
export function createIndependentFrameCache({
	directory,
	maxBytes = INDEPENDENT_FRAME_CACHE_MAX_BYTES,
	now = Date.now,
}: {
	directory: string;
	maxBytes?: number;
	now?: () => number;
}) {
	let index: Promise<Map<string, { bytes: number; usedAt: number }>> | null =
		null;
	const files = ({ key }: { key: string }) => ({
		png: path.join(directory, `${key}.png`),
		entry: path.join(directory, `${key}.json`),
	});

	function loadIndex() {
		index ??= (async () => {
			const entries = new Map<string, { bytes: number; usedAt: number }>();
			const names = await readdir(directory).catch(() => [] as string[]);
			for (const name of names) {
				const match = /^([a-f0-9]{64})\.(png|json)$/.exec(name);
				if (!match) {
					// Partial writes from an interrupted session.
					if (name.includes(".partial-"))
						await rm(path.join(directory, name), { force: true });
					continue;
				}
				const metadata = await stat(path.join(directory, name)).catch(
					() => null
				);
				if (!metadata?.isFile()) continue;
				const entry = entries.get(match[1]) ?? { bytes: 0, usedAt: 0 };
				entry.bytes += metadata.size;
				entry.usedAt = Math.max(entry.usedAt, metadata.mtimeMs);
				entries.set(match[1], entry);
			}
			return entries;
		})();
		return index;
	}

	async function remove({ key }: { key: string }) {
		const paths = files({ key });
		(await loadIndex()).delete(key);
		await Promise.all([
			rm(paths.png, { force: true }),
			rm(paths.entry, { force: true }),
		]);
	}

	async function read({
		key,
		width,
		height,
	}: {
		key: string;
		width: number;
		height: number;
	}): Promise<Uint8Array | null> {
		const entries = await loadIndex();
		if (!entries.has(key)) return null;
		const paths = files({ key });
		try {
			const [png, source] = await Promise.all([
				readFile(paths.png),
				readFile(paths.entry, "utf8"),
			]);
			const entry = entrySchema.parse(JSON.parse(source));
			if (
				entry.key !== key ||
				entry.width !== width ||
				entry.height !== height ||
				sha256({ bytes: png }) !== entry.pngSha256
			)
				throw new Error("Cached independent frame does not match its entry");
			const rgba = await decodePng({ png, width, height });
			if (sha256({ bytes: rgba }) !== entry.rgbaSha256)
				throw new Error("Cached independent frame pixels changed");
			const usedAt = now();
			const indexed = entries.get(key);
			if (indexed) indexed.usedAt = usedAt;
			const time = new Date(usedAt);
			await Promise.all([
				utimes(paths.png, time, time),
				utimes(paths.entry, time, time),
			]).catch(() => {});
			return rgba;
		} catch {
			// A damaged entry is a miss; the engine reprocesses the frame.
			await remove({ key });
			return null;
		}
	}

	async function write({
		key,
		width,
		height,
		png,
		rgba,
	}: {
		key: string;
		width: number;
		height: number;
		png: Uint8Array;
		rgba: Uint8Array;
	}) {
		const entries = await loadIndex();
		await mkdir(directory, { recursive: true });
		const paths = files({ key });
		const suffix = `.partial-${process.pid}-${now()}`;
		const entry = JSON.stringify({
			schemaVersion: 1,
			key,
			width,
			height,
			pngSha256: sha256({ bytes: png }),
			rgbaSha256: sha256({ bytes: rgba }),
		});
		// The entry lands last, so a reader never sees a half-written frame.
		await writeFile(paths.png + suffix, png);
		await rename(paths.png + suffix, paths.png);
		await writeFile(paths.entry + suffix, entry);
		await rename(paths.entry + suffix, paths.entry);
		entries.set(key, {
			bytes: png.byteLength + Buffer.byteLength(entry),
			usedAt: now(),
		});
		let total = 0;
		for (const { bytes } of entries.values()) total += bytes;
		if (total <= maxBytes) return;
		const oldest = [...entries.entries()].sort(
			([, left], [, right]) => left.usedAt - right.usedAt
		);
		for (const [oldKey, { bytes }] of oldest) {
			if (total <= maxBytes) break;
			if (oldKey === key) continue;
			await remove({ key: oldKey });
			total -= bytes;
		}
	}

	return { read, write };
}
