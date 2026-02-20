import { describe, expect, it } from "vitest";
import {
	createAgentConfig,
	agentOk,
	agentFail,
	parseLlmJson,
} from "../native-pipeline/vimax/agents/base-agent.js";
import { ReferenceImageSelector } from "../native-pipeline/vimax/agents/reference-selector.js";
import {
	CharacterPortraitRegistry,
	createCharacterPortrait,
} from "../native-pipeline/vimax/types/character.js";
import {
	ShotType,
	CameraMovement,
	createShotDescription,
} from "../native-pipeline/vimax/types/shot.js";

describe("ViMax Agents", () => {
	describe("AgentConfig", () => {
		it("createAgentConfig fills defaults", () => {
			const config = createAgentConfig({ name: "TestAgent" });
			expect(config.name).toBe("TestAgent");
			expect(config.model).toBe("gpt-4");
			expect(config.temperature).toBe(0.7);
			expect(config.max_retries).toBe(3);
			expect(config.timeout).toBe(60.0);
		});

		it("createAgentConfig allows overrides", () => {
			const config = createAgentConfig({
				name: "TestAgent",
				model: "claude-3",
				temperature: 0.2,
			});
			expect(config.model).toBe("claude-3");
			expect(config.temperature).toBe(0.2);
		});
	});

	describe("AgentResult helpers", () => {
		it("agentOk creates success result", () => {
			const result = agentOk({ value: 42 });
			expect(result.success).toBe(true);
			expect(result.result).toEqual({ value: 42 });
			expect(result.error).toBeUndefined();
		});

		it("agentOk with metadata", () => {
			const result = agentOk("data", { timing: 1.5 });
			expect(result.metadata).toEqual({ timing: 1.5 });
		});

		it("agentFail creates failure result", () => {
			const result = agentFail("Something went wrong");
			expect(result.success).toBe(false);
			expect(result.error).toBe("Something went wrong");
			expect(result.result).toBeUndefined();
		});
	});

	describe("parseLlmJson", () => {
		it("parses valid JSON directly", () => {
			const result = parseLlmJson('{"key": "value"}');
			expect(result).toEqual({ key: "value" });
		});

		it("parses JSON from markdown code fences", () => {
			const result = parseLlmJson('```json\n{"key": "value"}\n```');
			expect(result).toEqual({ key: "value" });
		});

		it("parses JSON with surrounding text", () => {
			const result = parseLlmJson(
				'Here is the result: {"key": "value"} hope that helps!'
			);
			expect(result).toEqual({ key: "value" });
		});

		it("handles trailing commas", () => {
			const result = parseLlmJson('{"key": "value", "arr": [1, 2, 3,],}');
			expect(result).toEqual({ key: "value", arr: [1, 2, 3] });
		});

		it("parses arrays when expect is 'array'", () => {
			const result = parseLlmJson("[1, 2, 3]", "array");
			expect(result).toEqual([1, 2, 3]);
		});

		it("parses array from markdown fences", () => {
			const result = parseLlmJson('```\n[{"a": 1}, {"b": 2}]\n```', "array");
			expect(result).toEqual([{ a: 1 }, { b: 2 }]);
		});

		it("throws on completely invalid input", () => {
			expect(() => parseLlmJson("no json here at all")).toThrow(
				"Could not parse JSON"
			);
		});

		it("parses JSON with code fence and extra whitespace", () => {
			const input = `Sure! Here's the JSON:

\`\`\`json
{
  "title": "Test",
  "value": 42
}
\`\`\`

Let me know if you need anything else.`;
			const result = parseLlmJson(input);
			expect(result).toEqual({ title: "Test", value: 42 });
		});

		it("parses deeply nested JSON", () => {
			const json = '{"a": {"b": {"c": [1, 2, {"d": true}]}}}';
			const result = parseLlmJson(json);
			expect(result).toEqual({ a: { b: { c: [1, 2, { d: true }] } } });
		});
	});

	describe("ReferenceImageSelector", () => {
		function buildRegistry(): CharacterPortraitRegistry {
			const registry = new CharacterPortraitRegistry("test-project");
			registry.addPortrait(
				createCharacterPortrait({
					character_name: "Alice Johnson",
					front_view: "/portraits/alice_front.png",
					side_view: "/portraits/alice_side.png",
					back_view: "/portraits/alice_back.png",
					three_quarter_view: "/portraits/alice_3q.png",
				})
			);
			registry.addPortrait(
				createCharacterPortrait({
					character_name: "Bob Smith",
					front_view: "/portraits/bob_front.png",
					side_view: "/portraits/bob_side.png",
				})
			);
			return registry;
		}

		it("selects front view for close-up shot", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Close-up of Alice",
				shot_type: ShotType.CLOSE_UP,
				camera_angle: "front",
				characters: ["Alice Johnson"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(result.shot_id).toBe("s1_shot1");
			expect(result.selected_references["Alice Johnson"]).toBe(
				"/portraits/alice_front.png"
			);
		});

		it("selects side view for profile angle", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Profile shot of Bob",
				shot_type: ShotType.MEDIUM,
				camera_angle: "profile",
				characters: ["Bob Smith"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(result.selected_references["Bob Smith"]).toBe(
				"/portraits/bob_side.png"
			);
		});

		it("selects back view for over_the_shoulder", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Over the shoulder of Alice",
				shot_type: ShotType.OVER_THE_SHOULDER,
				camera_angle: "behind",
				characters: ["Alice Johnson"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(result.selected_references["Alice Johnson"]).toBe(
				"/portraits/alice_back.png"
			);
		});

		it("handles fuzzy matching — case insensitive", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Shot of alice",
				characters: ["alice johnson"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(Object.keys(result.selected_references).length).toBeGreaterThan(0);
		});

		it("handles fuzzy matching — substring", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Shot of Alice",
				characters: ["Alice"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(Object.keys(result.selected_references).length).toBeGreaterThan(0);
		});

		it("handles fuzzy matching — word overlap", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Shot of Johnson",
				characters: ["Johnson (Alice)"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(Object.keys(result.selected_references).length).toBeGreaterThan(0);
		});

		it("returns empty references for unknown character", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shot = createShotDescription({
				shot_id: "s1_shot1",
				description: "Shot of stranger",
				characters: ["Unknown Character"],
			});
			const result = await selector.selectForShot(shot, registry);
			expect(Object.keys(result.selected_references).length).toBe(0);
			expect(result.selection_reason).toContain("No portrait found");
		});

		it("selectForShots handles multiple shots", async () => {
			const selector = new ReferenceImageSelector();
			const registry = buildRegistry();
			const shots = [
				createShotDescription({
					shot_id: "s1",
					description: "Shot 1",
					characters: ["Alice Johnson"],
				}),
				createShotDescription({
					shot_id: "s2",
					description: "Shot 2",
					characters: ["Bob Smith"],
				}),
			];
			const results = await selector.selectForShots(shots, registry);
			expect(results.length).toBe(2);
			expect(results[0].shot_id).toBe("s1");
			expect(results[1].shot_id).toBe("s2");
		});
	});
});
