import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCutPoints } from "./compare-cutpoints.mjs";

test("matches within tolerance and reports misses and spurious cuts", () => {
	const r = compareCutPoints({
		reference: [1.0, 4.5, 9.0],
		candidate: [1.1, 4.3, 6.0],
		tolerance: 0.25,
	});
	assert.equal(r.matched.length, 2);
	assert.deepEqual(r.missed, [9.0]);
	assert.deepEqual(r.spurious, [6.0]);
	assert.equal(+r.precision.toFixed(3), 0.667);
	assert.equal(+r.recall.toFixed(3), 0.667);
});

test("each candidate is used at most once", () => {
	const r = compareCutPoints({
		reference: [2.0, 2.1],
		candidate: [2.05],
		tolerance: 0.2,
	});
	assert.equal(r.matched.length, 1);
	assert.equal(r.missed.length, 1);
});
