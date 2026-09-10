/**
 * Closed-form least-squares similarity (translation, rotation, uniform scale)
 * between two point sets, used on the RANSAC inliers of each frame pair.
 *
 * With centred coordinates the 4-DOF model `q = s·R(θ)·p + t` has the exact
 * solution `s·cosθ = Σ(p·q) / Σ|p|²`, `s·sinθ = Σ(p×q) / Σ|p|²`; the
 * translation follows from the centroids. No reflection is allowed.
 */

export interface PlanePoint {
	x: number;
	y: number;
}

export interface SimilarityTransform {
	/** Uniform scale factor. */
	scale: number;
	/** Rotation in radians, positive = clockwise in image coordinates. */
	rotation: number;
	translationX: number;
	translationY: number;
}

export const IDENTITY_SIMILARITY: SimilarityTransform = {
	scale: 1,
	rotation: 0,
	translationX: 0,
	translationY: 0,
};

export function fitSimilarity({
	from,
	to,
}: {
	from: readonly PlanePoint[];
	to: readonly PlanePoint[];
}): SimilarityTransform | null {
	const count = Math.min(from.length, to.length);
	if (count < 2) return null;
	let fromX = 0;
	let fromY = 0;
	let toX = 0;
	let toY = 0;
	for (let index = 0; index < count; index += 1) {
		fromX += from[index].x;
		fromY += from[index].y;
		toX += to[index].x;
		toY += to[index].y;
	}
	fromX /= count;
	fromY /= count;
	toX /= count;
	toY /= count;
	let dot = 0;
	let cross = 0;
	let norm = 0;
	for (let index = 0; index < count; index += 1) {
		const px = from[index].x - fromX;
		const py = from[index].y - fromY;
		const qx = to[index].x - toX;
		const qy = to[index].y - toY;
		dot += px * qx + py * qy;
		cross += px * qy - py * qx;
		norm += px * px + py * py;
	}
	if (!(norm > 0)) return null;
	const a = dot / norm;
	const b = cross / norm;
	const scale = Math.hypot(a, b);
	if (!Number.isFinite(scale) || scale <= 0) return null;
	const rotation = Math.atan2(b, a);
	return {
		scale,
		rotation,
		translationX: toX - (a * fromX - b * fromY),
		translationY: toY - (b * fromX + a * fromY),
	};
}

/** Applies `q = s·R(θ)·p + t`. */
export function applySimilarity({
	transform,
	point,
}: {
	transform: SimilarityTransform;
	point: PlanePoint;
}): PlanePoint {
	const cosine = Math.cos(transform.rotation) * transform.scale;
	const sine = Math.sin(transform.rotation) * transform.scale;
	return {
		x: cosine * point.x - sine * point.y + transform.translationX,
		y: sine * point.x + cosine * point.y + transform.translationY,
	};
}
