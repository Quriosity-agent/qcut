/**
 * libass sizes a font so that its Windows ascent + descent equals the ASS
 * Fontsize, while the editor (CSS, canvas) sizes by the em square. The two
 * agree only for fonts whose win height is one em; Arial renders 11 % small,
 * Hiragino Sans GB 16 %. This module reads a font's OS/2 and head tables so
 * the ASS Fontsize can be scaled by winHeight / unitsPerEm and the exported
 * glyphs come out the size the preview shows.
 *
 * @module electron/claude/handlers/claude-export-handler/ass-font-metrics
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface FaceMetrics {
	/** Every family name the face answers to, in every language. */
	families: string[];
	subfamily: string;
	bold: boolean;
	italic: boolean;
	/** winAscent + winDescent over unitsPerEm: what libass sizes by. */
	winHeightEm: number;
	/** hhea ascender − descender over unitsPerEm: libass's line height. */
	lineHeightEm: number;
}

export interface AssFontMetrics {
	/** Multiply the editor's font size by this for the ASS Fontsize. */
	sizeFactor: number;
	/** The line height libass lays out, in em. */
	lineHeightEm: number;
}

const FONT_FILE_PATTERN = /\.(ttf|otf|ttc)$/i;
/** Hard cap on files scanned, so a pathological fonts folder cannot stall an export. */
const MAX_FONT_FILES = 4000;
/** Bytes read from a file's head: enough for a collection header of 64 faces. */
const READ_WINDOW = 4096;

let cachedIndex: Map<string, FaceMetrics[]> | undefined;
let indexBuilds = 0;

/** Platform font folders, in the order libass's fontconfig would see them. */
export function systemFontDirectories(): string[] {
	if (process.platform === "darwin") {
		return [
			"/System/Library/Fonts",
			"/System/Library/Fonts/Supplemental",
			"/Library/Fonts",
			path.join(homedir(), "Library/Fonts"),
		];
	}
	if (process.platform === "win32") {
		return [
			`${process.env.WINDIR ?? "C:\\Windows"}\\Fonts`,
			path.join(
				process.env.LOCALAPPDATA ?? "",
				"Microsoft",
				"Windows",
				"Fonts"
			),
		];
	}
	return [
		"/usr/share/fonts",
		"/usr/local/share/fonts",
		path.join(homedir(), ".fonts"),
		path.join(homedir(), ".local/share/fonts"),
	];
}

function listFontFiles(directories: string[]): string[] {
	const files: string[] = [];
	const visit = (directory: string, depth: number) => {
		if (files.length >= MAX_FONT_FILES || depth > 3) return;
		let entries: string[];
		try {
			entries = readdirSync(directory);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (files.length >= MAX_FONT_FILES) return;
			const full = path.join(directory, entry);
			try {
				const info = statSync(full);
				if (info.isDirectory()) visit(full, depth + 1);
				else if (FONT_FILE_PATTERN.test(entry)) files.push(full);
			} catch {
				// Unreadable entries are simply not indexed.
			}
		}
	};
	for (const directory of directories) visit(directory, 0);
	return files;
}

function readWindow(file: string): Buffer | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		const size = statSync(file).size;
		const buffer = Buffer.alloc(Math.min(size, READ_WINDOW));
		readSync(fd, buffer, 0, buffer.length, 0);
		return buffer;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function readTable({
	file,
	offset,
	length,
}: {
	file: string;
	offset: number;
	length: number;
}): Buffer | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, offset);
		return buffer;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/**
 * Every distinct name-table string carrying one of `nameIds`, in every
 * language: fontconfig matches a family by any of its localized names, so a
 * request for "Hiragino Sans GB" and one for "冬青黑體簡體中文" find the same face.
 */
function readNames({
	table,
	nameIds,
}: {
	table: Buffer;
	nameIds: number[];
}): string[] {
	if (table.length < 6) return [];
	const count = table.readUInt16BE(2);
	const stringOffset = table.readUInt16BE(4);
	const names = new Set<string>();
	for (let index = 0; index < count; index += 1) {
		const record = 6 + index * 12;
		if (record + 12 > table.length) break;
		const platform = table.readUInt16BE(record);
		const id = table.readUInt16BE(record + 6);
		if (!nameIds.includes(id)) continue;
		const length = table.readUInt16BE(record + 8);
		const start = stringOffset + table.readUInt16BE(record + 10);
		if (start + length > table.length) continue;
		const bytes = table.subarray(start, start + length);
		const decoded =
			platform === 1
				? bytes.toString("latin1").trim()
				: swapUtf16(bytes).trim();
		if (decoded) names.add(decoded);
	}
	return [...names];
}

/** OpenType stores UTF-16 big-endian; Node decodes little-endian. */
function swapUtf16(bytes: Buffer): string {
	const swapped = Buffer.from(bytes);
	swapped.swap16();
	return swapped.toString("utf16le");
}

function readFace({
	file,
	directoryOffset,
}: {
	file: string;
	directoryOffset: number;
}): FaceMetrics | undefined {
	// A collection's face directories can sit anywhere in the file, so the
	// directory is read at its offset rather than from the file's head.
	const header = readTable({ file, offset: directoryOffset, length: 12 });
	if (!header) return undefined;
	const tableCount = Math.min(header.readUInt16BE(4), 64);
	const records = readTable({
		file,
		offset: directoryOffset + 12,
		length: tableCount * 16,
	});
	if (!records) return undefined;
	const tables = new Map<string, { offset: number; length: number }>();
	for (let index = 0; index < tableCount; index += 1) {
		const record = index * 16;
		tables.set(records.toString("latin1", record, record + 4), {
			offset: records.readUInt32BE(record + 8),
			length: records.readUInt32BE(record + 12),
		});
	}
	const head = tables.get("head");
	const os2 = tables.get("OS/2");
	const name = tables.get("name");
	const hhea = tables.get("hhea");
	if (!head || !os2 || !name) return undefined;
	const headTable = readTable({ file, ...head });
	const os2Table = readTable({ file, ...os2 });
	const nameTable = readTable({ file, ...name });
	const hheaTable = hhea ? readTable({ file, ...hhea }) : undefined;
	if (
		!headTable ||
		!os2Table ||
		!nameTable ||
		headTable.length < 20 ||
		os2Table.length < 78
	) {
		return undefined;
	}
	const unitsPerEm = headTable.readUInt16BE(18);
	const winAscent = os2Table.readUInt16BE(74);
	const winDescent = os2Table.readUInt16BE(76);
	const selection = os2Table.readUInt16BE(62);
	if (!unitsPerEm || !(winAscent + winDescent)) return undefined;
	const hheaHeight =
		hheaTable && hheaTable.length >= 8
			? hheaTable.readInt16BE(4) - hheaTable.readInt16BE(6)
			: 0;
	const families = readNames({ table: nameTable, nameIds: [1, 16] });
	if (families.length === 0) return undefined;
	const subfamily =
		readNames({ table: nameTable, nameIds: [17, 2] })[0] ?? "Regular";
	return {
		families,
		subfamily,
		bold: (selection & 0x20) !== 0 || /bold/i.test(subfamily),
		italic: (selection & 0x01) !== 0 || /italic|oblique/i.test(subfamily),
		winHeightEm: (winAscent + winDescent) / unitsPerEm,
		lineHeightEm:
			(hheaHeight > 0 ? hheaHeight : winAscent + winDescent) / unitsPerEm,
	};
}

/** Every face in a font file: one for .ttf/.otf, each member of a .ttc. */
export function readFontFaces(file: string): FaceMetrics[] {
	const window = readWindow(file);
	if (!window || window.length < 12) return [];
	const tag = window.toString("latin1", 0, 4);
	const faces: FaceMetrics[] = [];
	if (tag === "ttcf") {
		const count = Math.min(window.readUInt32BE(8), 64);
		for (let index = 0; index < count; index += 1) {
			const entry = 12 + index * 4;
			if (entry + 4 > window.length) break;
			const face = readFace({
				file,
				directoryOffset: window.readUInt32BE(entry),
			});
			if (face) faces.push(face);
		}
		return faces;
	}
	const face = readFace({ file, directoryOffset: 0 });
	return face ? [face] : [];
}

function buildIndex(directories: string[]): Map<string, FaceMetrics[]> {
	indexBuilds += 1;
	const index = new Map<string, FaceMetrics[]>();
	for (const file of listFontFiles(directories)) {
		for (const face of readFontFaces(file)) {
			for (const family of face.families) {
				const key = family.toLowerCase();
				const faces = index.get(key) ?? [];
				faces.push(face);
				index.set(key, faces);
			}
		}
	}
	return index;
}

/**
 * How libass will size and lay out `family`: the Fontsize factor
 * (winHeight / unitsPerEm, so the exported em is the editor's) and the line
 * height it uses, from the face nearest the requested weight and slant. An
 * uninstalled family gets a factor of 1 and a one-em line, since libass will
 * substitute a font of its own choosing.
 */
export function assFontMetrics({
	family,
	bold = false,
	italic = false,
	directories,
}: {
	family: string;
	bold?: boolean;
	italic?: boolean;
	/** Folders to index instead of the system's; such an index is not kept. */
	directories?: string[];
}): AssFontMetrics {
	if (directories) {
		return metricsFrom({
			index: buildIndex(directories),
			family,
			bold,
			italic,
		});
	}
	// The system index is scanned once per process (thousands of files, each
	// opened for its tables); every overlay of every export reuses it.
	cachedIndex ??= buildIndex(systemFontDirectories());
	return metricsFrom({ index: cachedIndex, family, bold, italic });
}

/** How many times a font index was built; for tests of the cache. */
export function assFontIndexBuilds(): number {
	return indexBuilds;
}

/** The Fontsize factor alone; see `assFontMetrics`. */
export function assFontSizeFactor(options: {
	family: string;
	bold?: boolean;
	italic?: boolean;
	directories?: string[];
}): number {
	return assFontMetrics(options).sizeFactor;
}

function metricsFrom({
	index,
	family,
	bold,
	italic,
}: {
	index: Map<string, FaceMetrics[]>;
	family: string;
	bold: boolean;
	italic: boolean;
}): AssFontMetrics {
	const faces = index.get(family.trim().toLowerCase());
	if (!faces?.length) return { sizeFactor: 1, lineHeightEm: 1 };
	const scored = faces
		.map((face) => ({
			face,
			score: (face.bold === bold ? 2 : 0) + (face.italic === italic ? 1 : 0),
		}))
		.sort((left, right) => right.score - left.score);
	const { winHeightEm, lineHeightEm } = scored[0].face;
	const plausible = (value: number) =>
		Number.isFinite(value) && value > 0.5 && value < 3;
	return {
		sizeFactor: plausible(winHeightEm) ? winHeightEm : 1,
		lineHeightEm: plausible(lineHeightEm) ? lineHeightEm : 1,
	};
}

/** Drops the cached index, for tests that point at their own folders. */
export function resetAssFontMetricsCache(): void {
	cachedIndex = undefined;
}
