#!/usr/bin/env node
// Compare two cut-point lists (seconds) with a tolerance: precision / recall / matched pairs.
// Usage: node compare-cutpoints.mjs reference.json candidate.json [--tolerance 0.25]
// Each file is either a JSON array of seconds, or {"cutPoints":[...]} / {"scenes":[{"timestamp":..}]}
// (the latter is QCut's analyze/:pid/scenes shape).
import { readFileSync } from "node:fs";

function loadCutPoints(file) {
	const raw = JSON.parse(readFileSync(file, "utf8"));
	const list = Array.isArray(raw)
		? raw
		: (raw.cutPoints ??
			raw.scenes?.map((s) => s.timestamp) ??
			raw.segments?.map((s) => s.start));
	if (!Array.isArray(list)) throw new Error(`${file}: no cut point list found`);
	return list
		.map(Number)
		.filter((t) => Number.isFinite(t) && t > 0)
		.sort((a, b) => a - b);
}

export function compareCutPoints({ reference, candidate, tolerance = 0.25 }) {
	const used = new Set();
	const matched = [];
	for (const r of reference) {
		let best = -1;
		let bestDist = Number.POSITIVE_INFINITY;
		candidate.forEach((c, i) => {
			const d = Math.abs(c - r);
			if (!used.has(i) && d <= tolerance && d < bestDist) {
				best = i;
				bestDist = d;
			}
		});
		if (best !== -1) {
			used.add(best);
			matched.push({
				reference: r,
				candidate: candidate[best],
				delta: candidate[best] - r,
			});
		}
	}
	const missed = reference.filter(
		(r) => !matched.some((m) => m.reference === r)
	);
	const spurious = candidate.filter((_, i) => !used.has(i));
	const precision = candidate.length ? matched.length / candidate.length : 1;
	const recall = reference.length ? matched.length / reference.length : 1;
	const meanAbsDelta = matched.length
		? matched.reduce((s, m) => s + Math.abs(m.delta), 0) / matched.length
		: 0;
	return { matched, missed, spurious, precision, recall, meanAbsDelta };
}

if (
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].split("/").pop())
) {
	const [refFile, candFile] = process.argv.slice(2);
	const tolIndex = process.argv.indexOf("--tolerance");
	const tolerance = tolIndex !== -1 ? Number(process.argv[tolIndex + 1]) : 0.25;
	if (!refFile || !candFile) {
		console.error(
			"usage: compare-cutpoints.mjs reference.json candidate.json [--tolerance s]"
		);
		process.exit(2);
	}
	const result = compareCutPoints({
		reference: loadCutPoints(refFile),
		candidate: loadCutPoints(candFile),
		tolerance,
	});
	console.log(
		JSON.stringify(
			{
				tolerance,
				precision: +result.precision.toFixed(3),
				recall: +result.recall.toFixed(3),
				meanAbsDelta: +result.meanAbsDelta.toFixed(3),
				matched: result.matched.length,
				missed: result.missed,
				spurious: result.spurious,
			},
			null,
			2
		)
	);
}
