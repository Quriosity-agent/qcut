import assert from "node:assert/strict";
import { PORTRAIT_SOURCE_PRE_ROLL_LIMITS } from "../jianying-portrait-adjustment-contract";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request";
import { compareRgbaPixels } from "../beauty-lab/beauty-lab-rgba-metrics";
import type { PortraitSessionProvider } from "./jianying-portrait-session-plan";
import {
	rgbaHash,
	type MinutePlan,
} from "./jianying-portrait-acceptance-fixture";

export function minuteSeekHistory({
	plan,
	index,
}: {
	plan: MinutePlan;
	index: number;
}) {
	assert(
		Number.isSafeInteger(index) && index > 0 && index < plan.frames.length,
		"Invalid seek target"
	);
	const maximum = Math.min(
		PORTRAIT_SOURCE_PRE_ROLL_LIMITS.frames,
		Math.floor(
			PORTRAIT_SOURCE_PRE_ROLL_LIMITS.bytes / (plan.width * plan.height * 4)
		)
	);
	const target = plan.frames[index];
	const frames = plan.frames
		.slice(0, index)
		.filter(
			({ time }) =>
				target.time > time &&
				target.time - time <= PORTRAIT_SOURCE_PRE_ROLL_LIMITS.seconds
		)
		.slice(-maximum);
	assert(
		maximum > 0 && frames.length > 0,
		"No bounded real source history available"
	);
	return frames;
}

export async function runMinuteSeekAcceptance({
	plan,
	readFrame,
	createProvider,
	onSample,
}: {
	plan: MinutePlan;
	readFrame: ({ index }: { index: number }) => Promise<Uint8Array>;
	createProvider: () => PortraitSessionProvider;
	onSample: ({
		id,
		actual,
		expected,
	}: {
		id: string;
		actual: Uint8Array;
		expected: Uint8Array;
	}) => Promise<void>;
}) {
	const provider = createProvider();
	const cases: unknown[] = [];
	let passed = true;
	const checkedFrame = async ({ index }: { index: number }) => {
		const rgba = await readFrame({ index });
		assert.equal(
			rgbaHash({ bytes: rgba }),
			plan.frames[index].sha256,
			"Seek history differs from CPU decoded fixture"
		);
		return rgba;
	};
	try {
		await [0.75, 0.25, 0.95].reduce(async (previous, fraction, step) => {
			await previous;
			const index = Math.floor((plan.frames.length - 1) * fraction);
			const history = minuteSeekHistory({ plan, index });
			const frames = await Promise.all(
				history.map(async ({ index: frameIndex, time }) => ({
					rgba: await checkedFrame({ index: frameIndex }),
					timestampSeconds: time,
				}))
			);
			const sourceKey = step === 2 ? "minute-seek-B" : "minute-seek-A";
			const request = parseJianyingPortraitRenderRequest({
				request: {
					width: plan.width,
					height: plan.height,
					rgba: await checkedFrame({ index }),
					frameNumber: index,
					timestampSeconds: plan.frames[index].time,
					sourceKey,
					adjustments: {
						enabled: true,
						values: { face_adjust_EnlargeEye: 60 },
					},
					sourcePreRoll: { sourceKey, frames },
				},
			});
			const actual = await provider.render(request);
			const { sourcePreRoll: _history, ...pausedRequest } = request;
			const paused = await provider.render(pausedRequest);
			const isolated = createProvider();
			try {
				const expected = await isolated.render(request);
				const difference = compareRgbaPixels({
					actual: actual.rgba,
					expected: expected.rgba,
					width: plan.width,
					height: plan.height,
				});
				const pauseExact =
					rgbaHash({ bytes: actual.rgba }) === rgbaHash({ bytes: paused.rgba });
				const accepted = difference.changedPixels === 0 && pauseExact;
				passed = passed && accepted;
				const id = [
					"forward-real-seek",
					"backward-real-seek",
					"source-change-real-seek",
				][step];
				cases.push({
					id,
					index,
					time: request.timestampSeconds,
					sourceKey,
					difference,
					pauseExact,
					passed: accepted,
					history: history.map(({ index: frameIndex, time, sha256 }) => ({
						index: frameIndex,
						time,
						sha256,
					})),
				});
				await onSample({ id, actual: actual.rgba, expected: expected.rgba });
			} finally {
				await isolated.clear();
			}
		}, Promise.resolve());
	} finally {
		await provider.clear();
	}
	return {
		passed,
		cases,
		providerCleared: true,
		scope:
			"global actual-frame pre-roll and paused repeat; not per-face recovery",
	};
}
