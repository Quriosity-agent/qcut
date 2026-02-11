import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TimelineTrack } from "@/types/timeline";
import { TimelineToolbar } from "../timeline-toolbar";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";

vi.mock("@/stores/timeline-store", () => ({
  useTimelineStore: vi.fn(),
}));

vi.mock("@/stores/playback-store", () => ({
  usePlaybackStore: vi.fn(),
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: vi.fn(),
}));

vi.mock("@/stores/scene-store", () => ({
  useSceneStore: vi.fn(),
}));

vi.mock("../scenes-view", () => ({
  ScenesView: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

type TimelineSelector<T> = (state: MockTimelineState) => T;
type PlaybackSelector<T> = (state: MockPlaybackState) => T;
type ProjectSelector<T> = (state: MockProjectState) => T;

interface MockTimelineState {
  tracks: TimelineTrack[];
  addTrack: (trackType: "media") => string;
  addElementToTrack: (
    trackId: string,
    element: Record<string, unknown>
  ) => void;
  removeElementFromTrack: (trackId: string, elementId: string) => void;
  removeElementFromTrackWithRipple: (
    trackId: string,
    elementId: string
  ) => void;
  selectedElements: Array<{ trackId: string; elementId: string }>;
  clearSelectedElements: () => void;
  splitElement: (trackId: string, elementId: string, time: number) => string;
  splitAndKeepLeft: (trackId: string, elementId: string, time: number) => void;
  splitAndKeepRight: (trackId: string, elementId: string, time: number) => void;
  separateAudio: (trackId: string, elementId: string) => void;
  snappingEnabled: boolean;
  toggleSnapping: () => void;
  rippleEditingEnabled: boolean;
  toggleRippleEditing: () => void;
  showEffectsTrack: boolean;
  toggleEffectsTrack: () => void;
}

interface MockPlaybackState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  toggle: () => void;
}

interface MockProjectState {
  toggleBookmark: (time: number) => Promise<void>;
  isBookmarked: (time: number) => boolean;
}

describe("TimelineToolbar", () => {
  const splitElement = vi.fn(() => "split-el");
  const setZoomLevel = vi.fn();

  const timelineState: MockTimelineState = {
    tracks: [
      {
        id: "track-1",
        name: "Track 1",
        type: "media",
        elements: [
          {
            id: "element-1",
            type: "media",
            name: "Clip",
            mediaId: "media-1",
            duration: 10,
            startTime: 0,
            trimStart: 0,
            trimEnd: 0,
          },
        ],
      },
    ],
    addTrack: () => "new-track",
    addElementToTrack: vi.fn(),
    removeElementFromTrack: vi.fn(),
    removeElementFromTrackWithRipple: vi.fn(),
    selectedElements: [{ trackId: "track-1", elementId: "element-1" }],
    clearSelectedElements: vi.fn(),
    splitElement,
    splitAndKeepLeft: vi.fn(),
    splitAndKeepRight: vi.fn(),
    separateAudio: vi.fn(),
    snappingEnabled: true,
    toggleSnapping: vi.fn(),
    rippleEditingEnabled: false,
    toggleRippleEditing: vi.fn(),
    showEffectsTrack: true,
    toggleEffectsTrack: vi.fn(),
  };

  const playbackState: MockPlaybackState = {
    currentTime: 5,
    duration: 20,
    isPlaying: false,
    toggle: vi.fn(),
  };

  const projectState: MockProjectState = {
    toggleBookmark: vi.fn(async () => {}),
    isBookmarked: vi.fn(() => false),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (
      useTimelineStore as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(<T,>(selector: TimelineSelector<T>) =>
      selector(timelineState)
    );
    (
      usePlaybackStore as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(<T,>(selector: PlaybackSelector<T>) =>
      selector(playbackState)
    );
    (useProjectStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      <T,>(selector: ProjectSelector<T>) => selector(projectState)
    );
    (useSceneStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      scenes: [],
      currentScene: null,
    });
  });

  it("renders with play button", () => {
    render(<TimelineToolbar zoomLevel={1} setZoomLevel={setZoomLevel} />);
    expect(screen.getByTestId("timeline-play-button")).toBeInTheDocument();
  });

  it("shows zoom controls", () => {
    render(<TimelineToolbar zoomLevel={1} setZoomLevel={setZoomLevel} />);
    expect(screen.getByTestId("zoom-in-button")).toBeInTheDocument();
    expect(screen.getByTestId("zoom-out-button")).toBeInTheDocument();
  });

  it("split button calls splitElement", () => {
    render(<TimelineToolbar zoomLevel={1} setZoomLevel={setZoomLevel} />);
    fireEvent.click(screen.getByTestId("split-clip-button"));
    expect(splitElement).toHaveBeenCalledWith("track-1", "element-1", 5);
  });
});
