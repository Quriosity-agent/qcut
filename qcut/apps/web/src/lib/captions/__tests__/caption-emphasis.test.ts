import { describe, expect, it } from "vitest";
import {
	applyEmphasisUpdates,
	captionsToSegments,
	clearEmphasisUpdates,
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

	it("remembers each caption's own look once and restores it when cleared", () => {
		const preset = findEmphasisPreset({ presetId: DEFAULT_EMPHASIS_PRESET_ID });
		const red = { ...resolveSubtitleStyle(), fontColor: "#ff0000" };
		const blue = { ...resolveSubtitleStyle(), fontColor: "#0000ff" };
		const captions = [
			{ id: "a", style: red },
			{ id: "b", style: blue },
			{ id: "c", style: undefined },
		];
		const applied = applyEmphasisUpdates({ captions, ids: ["b", "a"], preset });
		expect(applied.map((update) => update.id)).toEqual(["a", "b"]);
		expect(applied[0].updates).toMatchObject({
			emphasis: true,
			emphasisBaseStyle: red,
			style: preset.style,
		});

		const emphasized = captions.map((caption) => {
			const update = applied.find((item) => item.id === caption.id);
			return update ? { ...caption, ...update.updates } : caption;
		});
		// Re-applying keeps the remembered look instead of the highlight.
		const reapplied = applyEmphasisUpdates({
			captions: emphasized,
			ids: ["a"],
			preset,
		});
		expect(reapplied[0].updates).not.toHaveProperty("emphasisBaseStyle");

		const cleared = clearEmphasisUpdates({ captions: emphasized });
		expect(cleared.map((update) => update.id)).toEqual(["a", "b"]);
		const byId = Object.fromEntries(
			cleared.map((update) => [update.id, update.updates])
		);
		expect(byId.a.emphasis).toBe(false);
		expect(byId.a.emphasisBaseStyle).toBeUndefined();
		expect(byId.a.style?.fontColor).toBe("#ff0000");
		expect(byId.b.style?.fontColor).toBe("#0000ff");
	});

	it("clears highlight-only keys and falls back to the lane look without a memory", () => {
		const plain = { ...resolveSubtitleStyle(), fontColor: "#123456" };
		const highlight = {
			...resolveSubtitleStyle(),
			karaokeMode: "word-highlight" as const,
			highlightColor: "#22d3ee",
		};
		const [update] = clearEmphasisUpdates({
			captions: [
				{ id: "plain", style: plain },
				{ id: "legacy", emphasis: true, style: highlight },
			],
		});
		expect(update.id).toBe("legacy");
		const merged = { ...highlight, ...update.updates.style };
		expect(merged.fontColor).toBe("#123456");
		expect(merged.karaokeMode).toBeUndefined();
		expect(merged.highlightColor).toBeUndefined();
	});
});
