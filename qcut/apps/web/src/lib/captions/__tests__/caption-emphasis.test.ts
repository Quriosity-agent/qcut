import { describe, expect, it } from "vitest";
import {
	captionsToSegments,
	DEFAULT_EMPHASIS_PRESET_ID,
	findEmphasisPreset,
	pickEmphasisCandidates,
	resolveLaneBaseStyle,
} from "../caption-emphasis";
import { resolveSubtitleStyle } from "../subtitle-style";

describe("caption emphasis helpers", () => {
	it("picks the strongest quote-like captions, at most a fifth of the lane", () => {
		const captions = [
			{ id: "a", text: "今天天气不错" },
			{ id: "b", text: "记住，这一步是整个流程的关键，必须先做" },
			{ id: "c", text: "为什么大家总是忽略核心问题？" },
			{ id: "d", text: "好的" },
			{ id: "e", text: "接下来我们看第二部分" },
			{ id: "f", text: "然后" },
			{ id: "g", text: "嗯" },
			{ id: "h", text: "再见" },
			{ id: "i", text: "谢谢" },
			{ id: "j", text: "拜拜" },
		];
		expect(pickEmphasisCandidates({ captions })).toEqual(["c", "b"]);
	});

	it("keeps at least one candidate on short lanes and none when nothing scores", () => {
		expect(
			pickEmphasisCandidates({
				captions: [
					{ id: "a", text: "嗯" },
					{ id: "b", text: "关键是不要放弃，必须坚持下去" },
				],
			})
		).toEqual(["b"]);
		expect(
			pickEmphasisCandidates({ captions: [{ id: "a", text: "嗯" }] })
		).toEqual([]);
	});

	it("falls back to the default key-point preset for unknown ids", () => {
		expect(findEmphasisPreset({ presetId: "nope" }).id).toBe(
			DEFAULT_EMPHASIS_PRESET_ID
		);
		expect(findEmphasisPreset({ presetId: "variety-pop" }).id).toBe(
			"variety-pop"
		);
	});

	it("maps captions to labeler segments with index ids", () => {
		const [segment] = captionsToSegments({
			captions: [{ text: "hi", startTime: 1.5, duration: 2 }],
		});
		expect(segment).toMatchObject({ id: 0, start: 1.5, end: 3.5, text: "hi" });
	});

	it("takes the lane's base look from the first plain caption", () => {
		const plainStyle = { ...resolveSubtitleStyle(), fontColor: "#123456" };
		const base = resolveLaneBaseStyle({
			captions: [
				{ emphasis: true, style: { ...plainStyle, fontColor: "#ffe066" } },
				{ emphasis: false, style: plainStyle },
			],
		});
		expect(base.fontColor).toBe("#123456");
		expect(
			resolveLaneBaseStyle({
				captions: [{ emphasis: true, style: plainStyle }],
			}).fontColor
		).toBe(resolveSubtitleStyle().fontColor);
	});
});
