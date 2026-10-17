/**
 * Chromium's DynamicsCompressorNode multiplies everything it outputs by a
 * fixed "makeup" gain taken from its static curve: (1 / curve(1.0))^0.6, the
 * Web Audio processing model. It applies whether or not the signal is being
 * compressed (a −1 dB limiter lifts the whole mix by 0.57 dB), while QCut's
 * compressor promises the user's makeup gain and its limiter a ceiling, as
 * the FFmpeg export implements them. The browser graphs divide this gain back
 * out after each node, using this mirror of Chromium's float32 curve.
 */

const f = Math.fround;

function dbToLinear(db: number) {
	return f(10 ** f(0.05 * db));
}

function linearToDb(linear: number) {
	return f(20 * Math.log10(linear));
}

interface StaticCurve {
	linearThreshold: number;
	kneeThreshold: number;
	kneeThresholdDb: number;
	yKneeThresholdDb: number;
	slope: number;
	k: number;
}

/** Exponential knee, slope-matched at the threshold. */
function kneeCurve({
	x,
	k,
	linearThreshold,
}: {
	x: number;
	k: number;
	linearThreshold: number;
}) {
	if (x < linearThreshold) return x;
	return f(
		linearThreshold + f(f(1 - f(Math.exp(f(-k * f(x - linearThreshold))))) / k)
	);
}

/** The knee's slope in dB at `x`, as Chromium approximates it. */
function slopeAt({
	x,
	k,
	linearThreshold,
}: {
	x: number;
	k: number;
	linearThreshold: number;
}) {
	if (x < linearThreshold) return 1;
	const x2 = f(x * 1.001);
	const xDb = linearToDb(x);
	const x2Db = linearToDb(x2);
	const yDb = linearToDb(kneeCurve({ x, k, linearThreshold }));
	const y2Db = linearToDb(kneeCurve({ x: x2, k, linearThreshold }));
	return f(f(y2Db - yDb) / f(x2Db - xDb));
}

/** The knee sharpness whose slope at the knee's end is `1 / ratio`. */
function kneeSharpness({
	thresholdDb,
	kneeDb,
	ratio,
	linearThreshold,
}: {
	thresholdDb: number;
	kneeDb: number;
	ratio: number;
	linearThreshold: number;
}) {
	const desiredSlope = f(1 / ratio);
	const x = dbToLinear(f(thresholdDb + kneeDb));
	let minK = f(0.1);
	let maxK = f(10_000);
	let k = f(5);
	for (let iteration = 0; iteration < 15; iteration++) {
		if (slopeAt({ x, k, linearThreshold }) < desiredSlope) maxK = k;
		else minK = k;
		k = f(Math.sqrt(f(minK * maxK)));
	}
	return k;
}

function staticCurve({
	thresholdDb,
	kneeDb,
	ratio,
}: {
	thresholdDb: number;
	kneeDb: number;
	ratio: number;
}): StaticCurve {
	const linearThreshold = dbToLinear(thresholdDb);
	const k = kneeSharpness({ thresholdDb, kneeDb, ratio, linearThreshold });
	const kneeThresholdDb = f(thresholdDb + kneeDb);
	const kneeThreshold = dbToLinear(kneeThresholdDb);
	return {
		linearThreshold,
		kneeThreshold,
		kneeThresholdDb,
		yKneeThresholdDb: linearToDb(
			kneeCurve({ x: kneeThreshold, k, linearThreshold })
		),
		slope: f(1 / ratio),
		k,
	};
}

/** The compression curve's output level for input level `x`. */
function saturate({ x, curve }: { x: number; curve: StaticCurve }) {
	if (x < curve.kneeThreshold)
		return kneeCurve({ x, k: curve.k, linearThreshold: curve.linearThreshold });
	const yDb = f(
		curve.yKneeThresholdDb +
			f(curve.slope * f(linearToDb(x) - curve.kneeThresholdDb))
	);
	return dbToLinear(yDb);
}

/**
 * The linear gain a DynamicsCompressorNode with these settings applies to
 * every sample on top of its compression (1 when the curve is neutral).
 */
export function dynamicsCompressorMakeupGain({
	thresholdDb,
	kneeDb,
	ratio,
}: {
	thresholdDb: number;
	kneeDb: number;
	ratio: number;
}) {
	const fullRangeGain = saturate({
		x: 1,
		curve: staticCurve({
			thresholdDb: f(thresholdDb),
			kneeDb: f(kneeDb),
			ratio: f(ratio),
		}),
	});
	return f(f(1 / fullRangeGain) ** 0.6);
}

/** The compressor's knee: Chromium's default, which every QCut graph keeps. */
export const COMPRESSOR_KNEE_DB = 30;
/** The limiter: a hard-kneed ratio-20 compressor. */
export const LIMITER_KNEE_DB = 0;
export const LIMITER_RATIO = 20;

/**
 * The gain after a compressor stage: the user's makeup with Chromium's own
 * divided out. `thresholdDb` and `ratio` are the values the node is set to.
 */
export function compressorOutputGain({
	thresholdDb,
	ratio,
	makeupGain,
}: {
	thresholdDb: number;
	ratio: number;
	makeupGain: number;
}) {
	return (
		makeupGain /
		dynamicsCompressorMakeupGain({
			thresholdDb,
			kneeDb: COMPRESSOR_KNEE_DB,
			ratio,
		})
	);
}

/** The gain after a limiter stage: Chromium's makeup divided out, so the ceiling holds. */
export function limiterOutputGain({
	thresholdDb,
	ratio,
}: {
	thresholdDb: number;
	ratio: number;
}) {
	return (
		1 /
		dynamicsCompressorMakeupGain({
			thresholdDb,
			kneeDb: LIMITER_KNEE_DB,
			ratio,
		})
	);
}
