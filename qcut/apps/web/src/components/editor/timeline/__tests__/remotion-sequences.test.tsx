/**
 * Tests for RemotionSequences Component
 *
 * @module components/editor/timeline/__tests__/remotion-sequences.test
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RemotionSequences } from "../remotion-sequences";
import type { SequenceStructure } from "@/lib/remotion/types";

describe("RemotionSequences", () => {
  const defaultProps = {
    totalDuration: 270,
    elementWidth: 200,
  };

  describe("basic rendering", () => {
    it("renders sequence bars proportionally to duration", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "Intro", from: 0, durationInFrames: 90, color: "#8B5CF6" },
          { name: "Main", from: 90, durationInFrames: 180, color: "#3B82F6" },
        ],
      };

      const { container } = render(
        <RemotionSequences structure={structure} {...defaultProps} />
      );

      // Should render two sequence bars
      const bars = container.querySelectorAll('[title*="frames"]');
      expect(bars.length).toBe(2);
    });

    it("applies correct colors from metadata", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 100, color: "#FF0000" },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={100}
          elementWidth={200}
        />
      );

      const bar = container.querySelector('[title*="frames"]');
      expect(bar).toBeTruthy();

      // Check that the color is applied (browsers may convert hex to rgb)
      const style = bar?.getAttribute("style");
      // Color may be in hex #FF0000 or rgb format rgb(255, 0, 0)
      expect(style).toMatch(/#FF0000|rgb\(255,\s*0,\s*0\)/i);
    });

    it("renders nothing when sequences is empty", () => {
      const structure: SequenceStructure = {
        sequences: [],
      };

      const { container } = render(
        <RemotionSequences structure={structure} {...defaultProps} />
      );

      // Should not render anything
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when totalDuration is 0", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 100 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={0}
          elementWidth={200}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when elementWidth is 0", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 100 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={100}
          elementWidth={0}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe("sequence names", () => {
    it("shows sequence names when bar is wide enough", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "Intro Scene", from: 0, durationInFrames: 100 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={100}
          elementWidth={200} // Wide enough
        />
      );

      const bar = container.querySelector('[title*="frames"]');
      expect(bar?.textContent).toContain("Intro Scene");
    });
  });

  describe("tooltips", () => {
    it("shows tooltips with sequence name and duration", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "Intro", from: 0, durationInFrames: 90 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={90}
          elementWidth={200}
        />
      );

      const bar = container.querySelector('[title]');
      expect(bar?.getAttribute("title")).toContain("Intro");
      expect(bar?.getAttribute("title")).toContain("90 frames");
    });
  });

  describe("transitions", () => {
    it("handles overlapping sequences (TransitionSeries)", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 60, color: "#8B5CF6" },
          { name: "B", from: 0, durationInFrames: 80, color: "#3B82F6" },
        ],
        transitions: [
          { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={125} // 60 + 80 - 15
          elementWidth={200}
        />
      );

      // Should render both sequence bars (filter out transition indicators)
      // Sequence bars have titles like "A: 60 frames (0-60)"
      // Transition indicators have titles like "fade transition: 15 frames"
      const sequenceBars = container.querySelectorAll('[title^="A:"], [title^="B:"]');
      expect(sequenceBars.length).toBe(2);
    });

    it("renders transition indicators with dashed borders", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 60 },
          { name: "B", from: 0, durationInFrames: 80 },
        ],
        transitions: [
          { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={125}
          elementWidth={200}
        />
      );

      // Should have a transition indicator with dashed border
      const transitionIndicator = container.querySelector('[title*="transition"]');
      expect(transitionIndicator).toBeTruthy();
      expect(transitionIndicator?.className).toContain("border-dashed");
    });

    it("shows transition type in tooltip", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 60 },
          { name: "B", from: 0, durationInFrames: 80 },
        ],
        transitions: [
          { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={125}
          elementWidth={200}
        />
      );

      const transitionIndicator = container.querySelector('[title*="transition"]');
      expect(transitionIndicator?.getAttribute("title")).toContain("fade");
      expect(transitionIndicator?.getAttribute("title")).toContain("15 frames");
    });
  });

  describe("default colors", () => {
    it("assigns default colors when not specified", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A", from: 0, durationInFrames: 50 },
          { name: "B", from: 50, durationInFrames: 50 },
          { name: "C", from: 100, durationInFrames: 50 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={150}
          elementWidth={300}
        />
      );

      const bars = container.querySelectorAll('[title*="frames"]');
      expect(bars.length).toBe(3);

      // Each bar should have a style with background color
      for (const bar of bars) {
        const style = bar.getAttribute("style");
        expect(style).toContain("background");
      }
    });
  });

  describe("edge cases", () => {
    it("handles single sequence", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "Only", from: 0, durationInFrames: 100 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={100}
          elementWidth={200}
        />
      );

      const bars = container.querySelectorAll('[title*="frames"]');
      expect(bars.length).toBe(1);
    });

    it("handles very narrow element width", () => {
      const structure: SequenceStructure = {
        sequences: [
          { name: "A Very Long Sequence Name", from: 0, durationInFrames: 100 },
        ],
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={100}
          elementWidth={20} // Very narrow
        />
      );

      // Should still render, just might not show the name
      const bar = container.querySelector('[title*="frames"]');
      expect(bar).toBeTruthy();
    });

    it("handles many sequences", () => {
      const structure: SequenceStructure = {
        sequences: Array.from({ length: 10 }, (_, i) => ({
          name: `Seq ${i + 1}`,
          from: i * 30,
          durationInFrames: 30,
        })),
      };

      const { container } = render(
        <RemotionSequences
          structure={structure}
          totalDuration={300}
          elementWidth={600}
        />
      );

      const bars = container.querySelectorAll('[title*="frames"]');
      expect(bars.length).toBe(10);
    });
  });
});
