/**
 * Border-cut-down motion constraint, ported from the recovered lens contract
 * (`research/independent-lens-contract/motion_constraint.cpp`, Move::Run
 * with border mode 11 as MergeUtil calls it).
 *
 * The input describes the sampling window of one output frame in source
 * pixels: the frame rectangle scaled about `center`, rotated, then
 * translated. The result clamps the scale into `[minimumScale, 1]`, bisects
 * the rotation until the rotated window fits the frame, and clips the
 * translation so the window stays inside `[0, extent - 1]` on both axes.
 * Arithmetic is binary32 like the native code (`Math.fround` on every op);
 * only the libm sine/cosine bits may differ across platforms.
 */

const f = Math.fround;

export interface LensPoint {
	x: number;
	y: number;
}

export interface RigidTransform {
	translationX: number;
	translationY: number;
	degrees: number;
	scale: number;
}

export interface MotionConstraint {
	width: number;
	height: number;
	center: LensPoint;
	minimumScale: number;
}

export const DEFAULT_MINIMUM_SCALE = 0.2;
const MOTION_EPSILON = f(1.0e-5);
const DEGREES_TO_RADIANS = f(0.017453299835324287);

function bounded(value: number, low: number, high: number): boolean {
	return Number.isFinite(value) && value >= low && value <= high;
}

/** std::min with the native signed-zero tie-break. */
function minimum(a: number, b: number): number {
	if (a === 0 && b === 0) {
		return Object.is(a, -0) || Object.is(b, -0) ? -0 : 0;
	}
	return Math.min(a, b);
}

/** std::max with the native signed-zero tie-break. */
function maximum(a: number, b: number): number {
	if (a === 0 && b === 0) {
		return Object.is(a, -0) && Object.is(b, -0) ? -0 : 0;
	}
	return Math.max(a, b);
}

/** Rotates points in place about `center`, binary32 like `rotate_unchecked`. */
export function rotatePoints({
	points,
	degrees,
	center,
}: {
	points: LensPoint[];
	degrees: number;
	center: LensPoint;
}): void {
	const radians = f(degrees * DEGREES_TO_RADIANS);
	const cosine = f(Math.cos(radians));
	const sine = f(Math.sin(radians));
	for (const point of points) {
		const x = f(point.x + -center.x);
		const y = f(point.y + -center.y);
		point.x = f(f(f(cosine * x) + f(-sine * y)) + center.x);
		point.y = f(f(f(sine * x) + f(cosine * y)) + center.y);
	}
}

function scalePoints({
	points,
	center,
	scale,
}: {
	points: LensPoint[];
	center: LensPoint;
	scale: number;
}): void {
	for (const point of points) {
		point.x = f(f(f(point.x + -center.x) * scale) + center.x);
		point.y = f(f(f(point.y + -center.y) * scale) + center.y);
	}
}

function inside({
	points,
	constraint,
}: {
	points: LensPoint[];
	constraint: MotionConstraint;
}): boolean {
	const right = f(constraint.width - 1);
	const bottom = f(constraint.height - 1);
	return points.every(
		(point) =>
			point.x >= 0 && point.x <= right && point.y >= 0 && point.y <= bottom
	);
}

interface Bounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function bounds(points: LensPoint[]): Bounds {
	const result = {
		left: points[0].x,
		top: points[0].y,
		right: points[0].x,
		bottom: points[0].y,
	};
	for (const point of points.slice(1)) {
		result.left = minimum(result.left, point.x);
		result.top = minimum(result.top, point.y);
		result.right = maximum(result.right, point.x);
		result.bottom = maximum(result.bottom, point.y);
	}
	return result;
}

function hasArea(rectangle: Bounds): boolean {
	return (
		f(rectangle.right - rectangle.left) >= 1 &&
		f(rectangle.bottom - rectangle.top) >= 1
	);
}

function restrictRotation({
	points,
	degrees,
	constraint,
}: {
	points: LensPoint[];
	degrees: number;
	constraint: MotionConstraint;
}): number {
	const rotated = points.map((point) => ({ ...point }));
	rotatePoints({ points: rotated, degrees, center: constraint.center });
	if (inside({ points: rotated, constraint })) return degrees;
	let accepted = 0;
	let rejected = degrees;
	let candidate = degrees;
	let previous = degrees;
	for (let iteration = 0; iteration < 30; iteration += 1) {
		const searching = degrees < 0 ? rejected < accepted : rejected > accepted;
		if (!searching) break;
		candidate = f(accepted + f(f(rejected - accepted) / 2));
		const delta = f(candidate - previous);
		// Native rotates the previous polygon, retaining accumulated error.
		rotatePoints({
			points: rotated,
			degrees: delta,
			center: constraint.center,
		});
		const fits = inside({ points: rotated, constraint });
		if (Math.abs(delta) < MOTION_EPSILON && fits) break;
		if (fits) accepted = candidate;
		else rejected = candidate;
		previous = candidate;
	}
	// Native returns the last candidate, including a last rejected candidate.
	return candidate;
}

function clipTranslation({
	value,
	extent,
	low,
	high,
}: {
	value: number;
	extent: number;
	low: number;
	high: number;
}): number {
	const first = f(-low);
	const second = f(f(extent - 1) - high);
	return minimum(
		maximum(value, minimum(first, second)),
		maximum(first, second)
	);
}

function active(value: number): boolean {
	return value > MOTION_EPSILON || value < -MOTION_EPSILON;
}

/**
 * Returns the constrained transform, or null when the request is out of the
 * native domain (QCut policy: reject rather than guess).
 */
export function constrainMotion({
	constraint,
	input,
}: {
	constraint: MotionConstraint;
	input: RigidTransform;
}): RigidTransform | null {
	if (
		!bounded(constraint.width, 1, 32768) ||
		!bounded(constraint.height, 1, 32768) ||
		!bounded(constraint.center.x, 0, constraint.width) ||
		!bounded(constraint.center.y, 0, constraint.height) ||
		!bounded(constraint.minimumScale, 0.01, 1) ||
		!bounded(input.scale, -4, 4) ||
		!bounded(input.degrees, -180, 180) ||
		!bounded(input.translationX, -4 * constraint.width, 4 * constraint.width) ||
		!bounded(input.translationY, -4 * constraint.height, 4 * constraint.height)
	) {
		return null;
	}
	const result: RigidTransform = {
		translationX: f(input.translationX),
		translationY: f(input.translationY),
		degrees: f(input.degrees),
		scale: maximum(minimum(f(input.scale), 1), f(constraint.minimumScale)),
	};
	const polygon: LensPoint[] = [
		{ x: 0, y: 0 },
		{ x: f(constraint.width - 1), y: 0 },
		{ x: f(constraint.width - 1), y: f(constraint.height - 1) },
		{ x: 0, y: f(constraint.height - 1) },
	];
	scalePoints({
		points: polygon,
		center: constraint.center,
		scale: result.scale,
	});
	if (active(result.degrees)) {
		if (hasArea(bounds(polygon))) {
			result.degrees = restrictRotation({
				points: polygon,
				degrees: result.degrees,
				constraint,
			});
		}
		// Border mode 11 keeps the scale, but native still crops by scale/scale.
		scalePoints({
			points: polygon,
			center: constraint.center,
			scale: f(result.scale / result.scale),
		});
		rotatePoints({
			points: polygon,
			degrees: result.degrees,
			center: constraint.center,
		});
	}
	if (active(result.translationX) || active(result.translationY)) {
		const rectangle = bounds(polygon);
		if (hasArea(rectangle)) {
			result.translationX = clipTranslation({
				value: result.translationX,
				extent: constraint.width,
				low: rectangle.left,
				high: rectangle.right,
			});
			result.translationY = clipTranslation({
				value: result.translationY,
				extent: constraint.height,
				low: rectangle.top,
				high: rectangle.bottom,
			});
		}
	}
	return result;
}
