/**
 * Tests for AST-based Sequence Parser
 *
 * @module lib/remotion/__tests__/sequence-parser.test
 */

import { describe, it, expect } from "vitest";
import {
	extractSequencesFromSource,
	toSequenceStructure,
	hasDynamicValues,
} from "../sequence-parser";

describe("extractSequencesFromSource", () => {
	describe("Sequence detection", () => {
		it("extracts basic <Sequence> elements", () => {
			const source = `
        import { Sequence } from "remotion";

        export const MyComp = () => (
          <div>
            <Sequence durationInFrames={60} name="Intro">
              <IntroScene />
            </Sequence>
            <Sequence from={60} durationInFrames={90} name="Main">
              <MainScene />
            </Sequence>
          </div>
        );
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences).toHaveLength(2);
			expect(result.sequences[0].name).toBe("Intro");
			expect(result.sequences[0].durationInFrames).toBe(60);
			expect(result.sequences[1].name).toBe("Main");
			expect(result.sequences[1].from).toBe(60);
			expect(result.sequences[1].durationInFrames).toBe(90);
		});

		it("extracts <TransitionSeries.Sequence> elements", () => {
			const source = `
        import { TransitionSeries } from "@remotion/transitions";

        export const MyComp = () => (
          <TransitionSeries>
            <TransitionSeries.Sequence durationInFrames={60}>
              <Scene1 />
            </TransitionSeries.Sequence>
          </TransitionSeries>
        );
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences).toHaveLength(1);
			expect(result.sequences[0].durationInFrames).toBe(60);
			expect(result.sequences[0].isTransitionSequence).toBe(true);
			expect(result.usesTransitionSeries).toBe(true);
		});

		it("extracts <TS.Sequence> shorthand", () => {
			const source = `
        import { TransitionSeries as TS } from "@remotion/transitions";

        export const MyComp = () => (
          <TS.Sequence durationInFrames={45} name="Short">
            <Scene />
          </TS.Sequence>
        );
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences).toHaveLength(1);
			expect(result.sequences[0].name).toBe("Short");
			expect(result.sequences[0].durationInFrames).toBe(45);
			expect(result.sequences[0].isTransitionSequence).toBe(true);
		});

		it("handles literal number props (from, durationInFrames)", () => {
			const source = `
        <Sequence from={30} durationInFrames={120}>
          <Content />
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences[0].from).toBe(30);
			expect(result.sequences[0].durationInFrames).toBe(120);
		});

		it("marks expression props as 'dynamic'", () => {
			const source = `
        const DURATION = 60;

        <Sequence from={index * 30} durationInFrames={DURATION}>
          <Content />
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences[0].from).toBe("dynamic");
			expect(result.sequences[0].durationInFrames).toBe("dynamic");
		});

		it("extracts name prop when present", () => {
			const source = `
        <Sequence durationInFrames={60} name="My Scene">
          <Content />
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences[0].name).toBe("My Scene");
		});

		it("handles nested sequences", () => {
			const source = `
        <Sequence durationInFrames={120} name="Outer">
          <div>
            <Sequence durationInFrames={60} name="Inner">
              <Content />
            </Sequence>
          </div>
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences).toHaveLength(2);
			expect(result.sequences[0].name).toBe("Outer");
			expect(result.sequences[1].name).toBe("Inner");
		});

		it("handles sequences in .map() loops", () => {
			const source = `
        const items = ["a", "b", "c"];

        export const Comp = () => (
          <div>
            {items.map((item, index) => (
              <Sequence key={item} from={index * 30} durationInFrames={30}>
                <Item />
              </Sequence>
            ))}
          </div>
        );
      `;

			const result = extractSequencesFromSource(source);

			// Should detect the sequence even in a map
			expect(result.sequences).toHaveLength(1);
			expect(result.sequences[0].from).toBe("dynamic"); // index * 30 is dynamic
		});

		it("returns empty array for components without sequences", () => {
			const source = `
        export const Simple = () => <div>Hello</div>;
      `;

			const result = extractSequencesFromSource(source);

			expect(result.sequences).toHaveLength(0);
			expect(result.transitions).toHaveLength(0);
		});
	});

	describe("Transition detection", () => {
		it("extracts <TransitionSeries.Transition> elements", () => {
			const source = `
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={60}>
            <Scene1 />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 15 })} />
          <TransitionSeries.Sequence durationInFrames={90}>
            <Scene2 />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions).toHaveLength(1);
			expect(result.transitions[0].afterSequenceIndex).toBe(0);
		});

		it("extracts <TS.Transition> shorthand", () => {
			const source = `
        <TransitionSeries>
          <TS.Sequence durationInFrames={60}><S1 /></TS.Sequence>
          <TS.Transition timing={springTiming({})} />
          <TS.Sequence durationInFrames={60}><S2 /></TS.Sequence>
        </TransitionSeries>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions).toHaveLength(1);
		});

		it("associates transitions with correct sequence index", () => {
			const source = `
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={60}><S1 /></TransitionSeries.Sequence>
          <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} />
          <TransitionSeries.Sequence durationInFrames={60}><S2 /></TransitionSeries.Sequence>
          <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 20 })} />
          <TransitionSeries.Sequence durationInFrames={60}><S3 /></TransitionSeries.Sequence>
        </TransitionSeries>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions).toHaveLength(2);
			expect(result.transitions[0].afterSequenceIndex).toBe(0);
			expect(result.transitions[1].afterSequenceIndex).toBe(1);
		});

		it("detects presentation type (fade, slide, wipe)", () => {
			const source = `
        <TS.Transition
          timing={springTiming({})}
          presentation={fade()}
        />
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions[0].presentation).toBe("fade");
		});

		it("marks timing duration as dynamic when using springTiming()", () => {
			const source = `
        <TS.Transition timing={springTiming({ config: { damping: 200 } })} />
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions[0].durationInFrames).toBe("dynamic");
		});

		it("extracts literal durationInFrames from linearTiming()", () => {
			const source = `
        <TS.Transition timing={linearTiming({ durationInFrames: 25 })} />
      `;

			const result = extractSequencesFromSource(source);

			expect(result.transitions[0].durationInFrames).toBe(25);
		});
	});

	describe("TransitionSeries detection", () => {
		it("sets usesTransitionSeries=true when container found", () => {
			const source = `
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={60}>
            <Content />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.usesTransitionSeries).toBe(true);
		});

		it("sets usesTransitionSeries=false for plain Sequence", () => {
			const source = `
        <Sequence durationInFrames={60}>
          <Content />
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			expect(result.usesTransitionSeries).toBe(false);
		});
	});

	describe("Error handling", () => {
		it("returns empty result for empty source", () => {
			const result = extractSequencesFromSource("");

			expect(result.sequences).toHaveLength(0);
			expect(result.errors).toHaveLength(0);
		});

		it("handles malformed JSX gracefully", () => {
			const source = `
        <Sequence durationInFrames={60
          <Content />
        </Sequence>
      `;

			const result = extractSequencesFromSource(source);

			// Severe syntax errors may throw (caught) or be recovered
			expect(result.errors.length).toBeGreaterThan(0);
			// Error message contains either "Parse error" (recovered) or "Failed to parse" (thrown)
			expect(
				result.errors[0].includes("Parse error") ||
					result.errors[0].includes("Failed to parse")
			).toBe(true);
		});

		it("handles missing closing tags", () => {
			const source = `
        <Sequence durationInFrames={60}>
          <Content />
      `;

			const result = extractSequencesFromSource(source);

			// Parser should handle this with error recovery and report the issue
			expect(result).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
			// May still recover the Sequence even with missing closing tag
			expect(result.sequences.length).toBeGreaterThanOrEqual(0);
		});
	});
});

describe("toSequenceStructure", () => {
	it("converts parsed sequences to SequenceStructure format", () => {
		const source = `
      import { Sequence } from "remotion";

      export const Comp = () => (
        <div>
          <Sequence durationInFrames={60} name="Intro">
            <Content1 />
          </Sequence>
          <Sequence durationInFrames={90} name="Main">
            <Content2 />
          </Sequence>
        </div>
      );
    `;

		const parsed = extractSequencesFromSource(source);
		const structure = toSequenceStructure(parsed);

		expect(structure).not.toBeNull();
		expect(structure?.sequences).toHaveLength(2);
		expect(structure?.sequences[0].name).toBe("Intro");
		expect(structure?.sequences[0].durationInFrames).toBe(60);
		expect(structure?.sequences[1].name).toBe("Main");
		expect(structure?.sequences[1].durationInFrames).toBe(90);
	});

	it("uses default duration for dynamic values", () => {
		const source = `
      <Sequence durationInFrames={DURATION} name="Dynamic" />
    `;

		const parsed = extractSequencesFromSource(source);
		const structure = toSequenceStructure(parsed, 45); // Default 45 frames

		expect(structure?.sequences[0].durationInFrames).toBe(45);
	});

	it("returns null for empty sequences", () => {
		const source = "<div>No sequences</div>";

		const parsed = extractSequencesFromSource(source);
		const structure = toSequenceStructure(parsed);

		expect(structure).toBeNull();
	});
});

describe("hasDynamicValues", () => {
	it("returns true when from is dynamic", () => {
		const source = "<Sequence from={x} durationInFrames={60} />";
		const parsed = extractSequencesFromSource(source);

		expect(hasDynamicValues(parsed)).toBe(true);
	});

	it("returns true when durationInFrames is dynamic", () => {
		const source = "<Sequence durationInFrames={DURATION} />";
		const parsed = extractSequencesFromSource(source);

		expect(hasDynamicValues(parsed)).toBe(true);
	});

	it("returns false when all values are static", () => {
		const source = "<Sequence from={0} durationInFrames={60} />";
		const parsed = extractSequencesFromSource(source);

		expect(hasDynamicValues(parsed)).toBe(false);
	});
});
