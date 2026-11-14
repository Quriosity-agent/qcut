/**
 * Reads the 3D LUT `editor element color --lut-file` puts on clips: a
 * .cube text file, or a .json file holding the cube as the editor stores it
 * (`{ size, values, domainMin?, domainMax? }`).
 *
 * @module electron/native-pipeline/editor/editor-element-lut-file
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { type CubeLut, readCubeLut } from "../../types/color-cube-lut.js";
import {
	decodeTextCube,
	findTextCubeSize,
} from "../filters/filter-lab-text-cube.js";

export interface LutFile {
	/** The file's TITLE, else its name without the extension. */
	name: string;
	cube: CubeLut;
}

function titleOf({ text }: { text: string }): string | undefined {
	const title = /^\s*TITLE\s+"?([^"\r\n]*)"?\s*$/im.exec(text)?.[1]?.trim();
	return title || undefined;
}

function cubeFromText({
	text,
	label,
}: {
	text: string;
	label: string;
}): CubeLut {
	if (/^\s*LUT_1D_SIZE\b/im.test(text)) {
		throw new Error(
			`${label} is a 1D LUT; QCut takes a 3D .cube (LUT_3D_SIZE)`
		);
	}
	const size = findTextCubeSize({ text });
	if (!size) {
		throw new Error(
			`${label} has no LUT_3D_SIZE line (a whole number from 2 to 256)`
		);
	}
	const decoded = decodeTextCube({ text });
	if (!decoded) {
		throw new Error(
			`${label} does not hold ${size ** 3} rows of three numbers after LUT_3D_SIZE ${size}`
		);
	}
	return readCubeLut({
		value: {
			size: decoded.size,
			values: Array.from(decoded.values),
			domainMin: decoded.domainMin,
			domainMax: decoded.domainMax,
		},
		path: label,
	});
}

function cubeFromJson({
	text,
	label,
}: {
	text: string;
	label: string;
}): CubeLut {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	// A cube on its own, or wrapped the way a clip's grade holds it.
	const holder = parsed as { cube?: unknown; lut?: { cube?: unknown } };
	const value = holder?.lut?.cube ?? holder?.cube ?? parsed;
	return readCubeLut({ value, path: label });
}

export async function readLutFile({
	filePath,
}: {
	filePath: string;
}): Promise<LutFile> {
	const label = basename(filePath);
	let text: string;
	try {
		text = await readFile(filePath, "utf8");
	} catch (error) {
		throw new Error(
			`Could not read the LUT file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	const extension = extname(filePath).toLowerCase();
	const fallbackName = basename(filePath, extname(filePath));
	if (extension === ".json") {
		return { name: fallbackName, cube: cubeFromJson({ text, label }) };
	}
	return {
		name: titleOf({ text }) ?? fallbackName,
		cube: cubeFromText({ text, label }),
	};
}
