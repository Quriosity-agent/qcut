/**
 * Tests for RemotionTimelineElement - Analysis Integration
 *
 * @module components/editor/timeline/__tests__/remotion-element-analysis.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { RemotionTimelineElement } from "../remotion-element";
import type { RemotionElement, TimelineTrack } from "@/types/timeline";
import type { RemotionComponentDefinition } from "@/lib/remotion/types";
import type { AnalysisResult } from "@/lib/remotion/sequence-analysis-service";

// Mock store hooks
const mockUseRemotionComponent = vi.fn();
const mockUseRemotionInstance = vi.fn();
const mockUseComponentAnalysis = vi.fn();

vi.mock("@/stores/remotion-store", () => ({
  useRemotionComponent: () => mockUseRemotionComponent(),
  useRemotionInstance: () => mockUseRemotionInstance(),
  useComponentAnalysis: () => mockUseComponentAnalysis(),
}));

// Mock child components
vi.mock("../remotion-sequences", () => ({
  RemotionSequences: ({ structure }: { structure: unknown }) => (
    <div data-testid="remotion-sequences">
      RemotionSequences: {JSON.stringify(structure)}
    </div>
  ),
}));

vi.mock("../parsed-sequence-overlay", () => ({
  ParsedSequenceOverlay: ({ sequences }: { sequences: unknown[] }) => (
    <div data-testid="parsed-sequence-overlay">
      ParsedSequenceOverlay: {sequences.length} sequences
    </div>
  ),
}));

// Mock duration calculator
vi.mock("@/lib/remotion/duration-calculator", () => ({
  calculateTotalDuration: vi.fn().mockReturnValue(150),
}));

describe("RemotionTimelineElement - Analysis Integration", () => {
  const mockElement: RemotionElement = {
    id: "element-1",
    type: "remotion",
    name: "Test Element",
    trackId: "track-1",
    componentId: "test-component",
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 0,
    hidden: false,
    locked: false,
    props: {},
    renderMode: "live",
  };

  const mockTrack: TimelineTrack = {
    id: "track-1",
    name: "Track 1",
    type: "video",
    elements: [],
    muted: false,
    locked: false,
    visible: true,
    height: 80,
  };

  const mockComponent: RemotionComponentDefinition = {
    id: "test-component",
    name: "Test Component",
    description: "A test component",
    category: "templates",
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    schema: { safeParse: () => ({ success: true }) } as never,
    defaultProps: {},
    component: () => null,
    source: "imported",
  };

  const mockProps = {
    element: mockElement,
    track: mockTrack,
    zoomLevel: 1,
    isSelected: false,
    onElementMouseDown: vi.fn(),
    onElementClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRemotionComponent.mockReturnValue(mockComponent);
    mockUseRemotionInstance.mockReturnValue(null);
    mockUseComponentAnalysis.mockReturnValue(undefined);
  });

  describe("visualization selection", () => {
    it("renders RemotionSequences when author metadata exists", () => {
      const componentWithMetadata: RemotionComponentDefinition = {
        ...mockComponent,
        sequenceStructure: {
          sequences: [
            { name: "Intro", from: 0, durationInFrames: 60 },
            { name: "Main", from: 60, durationInFrames: 90 },
          ],
        },
      };
      mockUseRemotionComponent.mockReturnValue(componentWithMetadata);

      render(<RemotionTimelineElement {...mockProps} />);

      expect(screen.getByTestId("remotion-sequences")).toBeInTheDocument();
      expect(screen.queryByTestId("parsed-sequence-overlay")).not.toBeInTheDocument();
    });

    it("renders ParsedSequenceOverlay when only analysis exists", () => {
      const analysisResult: AnalysisResult = {
        componentId: "test-component",
        parsed: {
          sequences: [
            { name: "Scene1", from: 0, durationInFrames: 60, line: 1, isTransitionSequence: false },
          ],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: {
          sequences: [{ name: "Scene1", from: 0, durationInFrames: 60 }],
        },
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "abc",
      };
      mockUseComponentAnalysis.mockReturnValue(analysisResult);

      render(<RemotionTimelineElement {...mockProps} />);

      expect(screen.getByTestId("parsed-sequence-overlay")).toBeInTheDocument();
      expect(screen.queryByTestId("remotion-sequences")).not.toBeInTheDocument();
    });

    it("prefers author metadata over parsed analysis", () => {
      const componentWithMetadata: RemotionComponentDefinition = {
        ...mockComponent,
        sequenceStructure: {
          sequences: [{ name: "Author Seq", from: 0, durationInFrames: 100 }],
        },
      };
      mockUseRemotionComponent.mockReturnValue(componentWithMetadata);

      const analysisResult: AnalysisResult = {
        componentId: "test-component",
        parsed: {
          sequences: [
            { name: "Parsed Seq", from: 0, durationInFrames: 50, line: 1, isTransitionSequence: false },
          ],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: {
          sequences: [{ name: "Parsed Seq", from: 0, durationInFrames: 50 }],
        },
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "abc",
      };
      mockUseComponentAnalysis.mockReturnValue(analysisResult);

      render(<RemotionTimelineElement {...mockProps} />);

      // Should show author metadata, not parsed
      expect(screen.getByTestId("remotion-sequences")).toBeInTheDocument();
      expect(screen.queryByTestId("parsed-sequence-overlay")).not.toBeInTheDocument();
    });

    it("renders nothing when no sequences available", () => {
      // No author metadata, no analysis
      mockUseRemotionComponent.mockReturnValue(mockComponent);
      mockUseComponentAnalysis.mockReturnValue(undefined);

      render(<RemotionTimelineElement {...mockProps} />);

      expect(screen.queryByTestId("remotion-sequences")).not.toBeInTheDocument();
      expect(screen.queryByTestId("parsed-sequence-overlay")).not.toBeInTheDocument();
    });
  });

  describe("dynamic values", () => {
    it("shows dynamic badge when hasDynamicValues is true", () => {
      const analysisResult: AnalysisResult = {
        componentId: "test-component",
        parsed: {
          sequences: [
            { name: "Dynamic", from: "dynamic", durationInFrames: 60, line: 1, isTransitionSequence: false },
          ],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: {
          sequences: [{ name: "Dynamic", from: 0, durationInFrames: 60 }],
        },
        hasDynamicValues: true,
        analyzedAt: Date.now(),
        sourceHash: "abc",
      };
      mockUseComponentAnalysis.mockReturnValue(analysisResult);

      render(<RemotionTimelineElement {...mockProps} />);

      expect(screen.getByText("~dynamic")).toBeInTheDocument();
    });

    it("hides dynamic badge for static sequences", () => {
      const analysisResult: AnalysisResult = {
        componentId: "test-component",
        parsed: {
          sequences: [
            { name: "Static", from: 0, durationInFrames: 60, line: 1, isTransitionSequence: false },
          ],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: {
          sequences: [{ name: "Static", from: 0, durationInFrames: 60 }],
        },
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "abc",
      };
      mockUseComponentAnalysis.mockReturnValue(analysisResult);

      render(<RemotionTimelineElement {...mockProps} />);

      expect(screen.queryByText("~dynamic")).not.toBeInTheDocument();
    });
  });

  describe("analysis integration", () => {
    it("handles undefined analysis gracefully", () => {
      mockUseComponentAnalysis.mockReturnValue(undefined);

      expect(() => {
        render(<RemotionTimelineElement {...mockProps} />);
      }).not.toThrow();
    });

    it("handles empty sequences in analysis", () => {
      const emptyAnalysis: AnalysisResult = {
        componentId: "test-component",
        parsed: {
          sequences: [],
          transitions: [],
          usesTransitionSeries: false,
          errors: [],
        },
        structure: null,
        hasDynamicValues: false,
        analyzedAt: Date.now(),
        sourceHash: "abc",
      };
      mockUseComponentAnalysis.mockReturnValue(emptyAnalysis);

      render(<RemotionTimelineElement {...mockProps} />);

      // Should not render ParsedSequenceOverlay for empty sequences
      expect(screen.queryByTestId("parsed-sequence-overlay")).not.toBeInTheDocument();
    });
  });
});
