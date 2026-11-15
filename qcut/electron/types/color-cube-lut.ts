/**
 * The 3D LUT a clip's grade can carry (`color.lut.cube`), as the editor API
 * takes it and the exports read it. Shared by the renderer bridge, the
 * FFmpeg export and the CLI so one rule decides what a usable cube is.
 *
 * `values` holds `size³` RGB triplets in .cube file order: red changes
 * fastest, then green, then blue.
 */

export type CubeLutTriplet = [number, number, number];

export interface CubeLut {
	size: number;
	domainMin: CubeLutTriplet;
	domainMax: CubeLutTriplet;
	values: number[];
}

export const MIN_CUBE_LUT_SIZE = 2;
export const MAX_CUBE_LUT_SIZE = 256;
const DEFAULT_DOMAIN_MIN: CubeLutTriplet = [0, 0, 0];
const DEFAULT_DOMAIN_MAX: CubeLutTriplet = [1, 1, 1];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTriplet(value: unknown): value is CubeLutTriplet {
	return (
		Array.isArray(value) &&
		value.length === 3 &&
		value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
	);
}

/**
 * A cube with the .cube default domain (0..1) where it names none. Nothing
 * else is checked: this is for cubes already stored, which must keep
 * rendering.
 */
export function withCubeLutDomain<T extends object>(
	cube: T
): T & { domainMin: CubeLutTriplet; domainMax: CubeLutTriplet } {
	const stored = cube as { domainMin?: unknown; domainMax?: unknown };
	if (isTriplet(stored.domainMin) && isTriplet(stored.domainMax)) {
		return cube as T & { domainMin: CubeLutTriplet; domainMax: CubeLutTriplet };
	}
	return {
		...cube,
		domainMin: isTriplet(stored.domainMin)
			? stored.domainMin
			: [...DEFAULT_DOMAIN_MIN],
		domainMax: isTriplet(stored.domainMax)
			? stored.domainMax
			: [...DEFAULT_DOMAIN_MAX],
	};
}

function readDomain({
	value,
	fallback,
	path,
}: {
	value: unknown;
	fallback: CubeLutTriplet;
	path: string;
}): CubeLutTriplet {
	if (value === undefined || value === null) return [...fallback];
	if (!isTriplet(value)) {
		throw new Error(`${path} must be three numbers, like [0, 0, 0]`);
	}
	return value;
}

/**
 * The cube a write may store: a whole-number `size`, exactly `size³ × 3`
 * finite `values`, and a domain that is either left out (0..1) or three
 * numbers per end with max above min. Throws naming the field otherwise, so
 * a cube that cannot be rendered is refused when it is written instead of
 * failing the export later.
 */
export function readCubeLut({
	value,
	path,
}: {
	value: unknown;
	path: string;
}): CubeLut {
	if (!isRecord(value)) {
		throw new Error(
			`${path} must be an object: { size, values, domainMin?, domainMax? }`
		);
	}
	const { size, values } = value;
	if (
		typeof size !== "number" ||
		!Number.isInteger(size) ||
		size < MIN_CUBE_LUT_SIZE ||
		size > MAX_CUBE_LUT_SIZE
	) {
		throw new Error(
			`${path}.size must be a whole number from ${MIN_CUBE_LUT_SIZE} to ${MAX_CUBE_LUT_SIZE} (got ${JSON.stringify(size)})`
		);
	}
	const expected = size ** 3 * 3;
	if (!Array.isArray(values)) {
		throw new Error(
			`${path}.values must be a list of ${expected} numbers (size³ × 3 for size ${size})`
		);
	}
	if (values.length !== expected) {
		throw new Error(
			`${path}.values must hold ${expected} numbers (size³ × 3 for size ${size}); it holds ${values.length}`
		);
	}
	const badIndex = values.findIndex(
		(entry) => typeof entry !== "number" || !Number.isFinite(entry)
	);
	if (badIndex >= 0) {
		throw new Error(
			`${path}.values[${badIndex}] must be a number (got ${JSON.stringify(values[badIndex])})`
		);
	}
	const domainMin = readDomain({
		value: value.domainMin,
		fallback: DEFAULT_DOMAIN_MIN,
		path: `${path}.domainMin`,
	});
	const domainMax = readDomain({
		value: value.domainMax,
		fallback: DEFAULT_DOMAIN_MAX,
		path: `${path}.domainMax`,
	});
	const flatAxis = domainMax.findIndex((max, axis) => max <= domainMin[axis]);
	if (flatAxis >= 0) {
		throw new Error(
			`${path}.domainMax must be above domainMin on every channel (channel ${flatAxis}: ${domainMin[flatAxis]}..${domainMax[flatAxis]})`
		);
	}
	return { size, values: values as number[], domainMin, domainMax };
}

/** Where a grade can carry a cube: the LUT, its skin LUT, and LUT passes. */
function gradeCubeSlots({ color }: { color: Record<string, unknown> }): Array<{
	path: string;
	holder: Record<string, unknown>;
	key: string;
}> {
	const slots: Array<{
		path: string;
		holder: Record<string, unknown>;
		key: string;
	}> = [];
	const lut = color.lut;
	if (isRecord(lut)) {
		if (lut.cube !== undefined && lut.cube !== null) {
			slots.push({ path: "lut.cube", holder: lut, key: "cube" });
		}
		const dual = lut.dual;
		if (isRecord(dual) && dual.skinCube !== undefined) {
			slots.push({
				path: "lut.dual.skinCube",
				holder: dual,
				key: "skinCube",
			});
		}
	}
	const multiPass = color.multiPass;
	if (isRecord(multiPass) && Array.isArray(multiPass.passes)) {
		for (const [index, pass] of multiPass.passes.entries()) {
			if (isRecord(pass) && pass.kind === "lut") {
				slots.push({
					path: `multiPass.passes[${index}].cube`,
					holder: pass,
					key: "cube",
				});
			}
		}
	}
	return slots;
}

/**
 * Checks every cube a grade carries and returns the grade with each cube's
 * domain filled in. A grade without cubes is returned as it is; otherwise
 * only the objects on the way to a cube are copied, never a cube's values.
 * Throws like `readCubeLut`, with `prefix` in front of the field.
 */
export function readGradeCubeLuts<T extends object>({
	color,
	prefix = "color",
}: {
	color: T;
	prefix?: string;
}): T {
	if (!isRecord(color) || gradeCubeSlots({ color }).length === 0) return color;
	const completed = copyGradeDownToCubes({ color });
	for (const slot of gradeCubeSlots({ color: completed })) {
		const stored = slot.holder[slot.key];
		readCubeLut({ value: stored, path: `${prefix}.${slot.path}` });
		slot.holder[slot.key] = withCubeLutDomain(stored as object);
	}
	return completed as T;
}

/**
 * The grade with its `lut`, `dual`, `multiPass`, pass list and LUT passes
 * copied, so filling a domain in does not change the caller's grade.
 */
function copyGradeDownToCubes({
	color,
}: {
	color: Record<string, unknown>;
}): Record<string, unknown> {
	const next: Record<string, unknown> = { ...color };
	if (isRecord(next.lut)) {
		const lut: Record<string, unknown> = { ...next.lut };
		if (isRecord(lut.dual)) lut.dual = { ...lut.dual };
		next.lut = lut;
	}
	if (isRecord(next.multiPass) && Array.isArray(next.multiPass.passes)) {
		next.multiPass = {
			...next.multiPass,
			passes: next.multiPass.passes.map((pass: unknown) =>
				isRecord(pass) && pass.kind === "lut" ? { ...pass } : pass
			),
		};
	}
	return next;
}
