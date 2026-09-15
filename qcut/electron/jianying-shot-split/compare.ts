/**
 * Pure comparison of the two shot-split engines' results: pairs each bridge cut
 * with the nearest torch cut within a small frame tolerance and reports what
 * only one side found.
 */

import type {
	JianyingShotSplitComparison,
	JianyingShotSplitCutMatch,
	JianyingShotSplitResult,
} from "../jianying-shot-split-contract.js";

export const SHOT_SPLIT_COMPARE_TOLERANCE_FRAMES = 1;

export function compareShotSplitResults({
	bridge,
	toleranceFrames = SHOT_SPLIT_COMPARE_TOLERANCE_FRAMES,
	torch,
}: {
	bridge: JianyingShotSplitResult;
	toleranceFrames?: number;
	torch: JianyingShotSplitResult;
}): JianyingShotSplitComparison {
	if (!Number.isSafeInteger(toleranceFrames) || toleranceFrames < 0) {
		throw new Error("镜头分割对比容差必须是非负整数");
	}
	const remaining = [...torch.cutFrames].sort(
		(first, second) => first - second
	);
	const matches: JianyingShotSplitCutMatch[] = [];
	const bridgeOnlyFrames: number[] = [];
	for (const bridgeFrame of [...bridge.cutFrames].sort(
		(first, second) => first - second
	)) {
		let best = -1;
		for (const [index, torchFrame] of remaining.entries()) {
			const distance = Math.abs(torchFrame - bridgeFrame);
			if (distance > toleranceFrames) continue;
			if (best === -1 || distance < Math.abs(remaining[best] - bridgeFrame)) {
				best = index;
			}
		}
		if (best === -1) {
			bridgeOnlyFrames.push(bridgeFrame);
			continue;
		}
		const [torchFrame] = remaining.splice(best, 1);
		matches.push({
			bridgeFrame,
			frameDelta: torchFrame - bridgeFrame,
			torchFrame,
		});
	}
	const union = matches.length + bridgeOnlyFrames.length + remaining.length;
	return {
		agreement: union === 0 ? 1 : matches.length / union,
		bridgeElapsedMs: bridge.elapsedMs,
		bridgeOnlyFrames,
		frameCountMatches: bridge.frameCount === torch.frameCount,
		matches,
		maxFrameDelta: matches.reduce(
			(largest, match) => Math.max(largest, Math.abs(match.frameDelta)),
			0
		),
		toleranceFrames,
		torchElapsedMs: torch.elapsedMs,
		torchOnlyFrames: remaining,
	};
}
