import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeElement,
  ClaudeTimeline,
} from "../../../../../electron/types/claude-api";
import { setupClaudeTimelineBridge } from "@/lib/claude-timeline-bridge";
import type { MediaItem } from "@/stores/media-store";

const storeMocks = vi.hoisted(() => {
  const timelineStoreState = {
    tracks: [],
    findOrCreateTrack: vi.fn(),
    addElementToTrack: vi.fn(),
    removeElementFromTrack: vi.fn(),
  };

  const mediaStoreState: { mediaItems: MediaItem[] } = {
    mediaItems: [],
  };

  const projectStoreState = {
    activeProject: null,
  };

  return {
    timelineStoreState,
    mediaStoreState,
    projectStoreState,
    timelineGetState: vi.fn(() => timelineStoreState),
    mediaGetState: vi.fn(() => mediaStoreState),
    projectGetState: vi.fn(() => projectStoreState),
  };
});

vi.mock("@/stores/timeline-store", () => ({
  useTimelineStore: {
    getState: storeMocks.timelineGetState,
  },
}));

vi.mock("@/stores/media-store", () => ({
  useMediaStore: {
    getState: storeMocks.mediaGetState,
  },
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: {
    getState: storeMocks.projectGetState,
  },
}));

type AddElementHandler = (element: Partial<ClaudeElement>) => void;

function setupTimelineBridgeWithHandlers(): {
  addElementHandler: AddElementHandler;
  timelineApi: {
    onRequest: ReturnType<typeof vi.fn>;
    onApply: ReturnType<typeof vi.fn>;
    onAddElement: ReturnType<typeof vi.fn>;
    onUpdateElement: ReturnType<typeof vi.fn>;
    onRemoveElement: ReturnType<typeof vi.fn>;
    sendResponse: ReturnType<typeof vi.fn>;
    removeListeners: ReturnType<typeof vi.fn>;
  };
} {
  let addElementHandler: AddElementHandler | null = null;

  const timelineApi = {
    onRequest: vi.fn((_callback: () => void) => {}),
    onApply: vi.fn((_callback: (timeline: ClaudeTimeline) => void) => {}),
    onAddElement: vi.fn(
      (callback: (element: Partial<ClaudeElement>) => void) => {
        addElementHandler = callback;
      }
    ),
    onUpdateElement: vi.fn(
      (
        _callback: (data: {
          elementId: string;
          changes: Partial<ClaudeElement>;
        }) => void
      ) => {}
    ),
    onRemoveElement: vi.fn((_callback: (elementId: string) => void) => {}),
    sendResponse: vi.fn(),
    removeListeners: vi.fn(),
  };

  (
    window as unknown as {
      electronAPI?: {
        claude?: {
          timeline?: typeof timelineApi;
        };
      };
    }
  ).electronAPI = {
    claude: {
      timeline: timelineApi,
    },
  };

  setupClaudeTimelineBridge();

  if (!addElementHandler) {
    throw new Error("addElement handler was not registered");
  }
  const registeredAddElementHandler: AddElementHandler = addElementHandler;

  return {
    addElementHandler: registeredAddElementHandler,
    timelineApi,
  };
}

describe("setupClaudeTimelineBridge - add element", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    storeMocks.timelineStoreState.findOrCreateTrack.mockReset();
    storeMocks.timelineStoreState.addElementToTrack.mockReset();
    storeMocks.timelineStoreState.removeElementFromTrack.mockReset();

    storeMocks.timelineStoreState.findOrCreateTrack.mockImplementation(
      (trackType: string) => `${trackType}-track`
    );
    storeMocks.timelineStoreState.tracks = [];

    storeMocks.mediaStoreState.mediaItems = [];

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("adds a media element when sourceName matches imported media", () => {
    storeMocks.mediaStoreState.mediaItems = [
      {
        id: "media-1",
        name: "clip-a.mp4",
        type: "video",
        file: new File([""], "clip-a.mp4"),
        duration: 12,
      },
    ];

    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    addElementHandler({
      type: "video",
      sourceName: "clip-a.mp4",
      startTime: 2,
      endTime: 6,
    });

    expect(
      storeMocks.timelineStoreState.findOrCreateTrack
    ).toHaveBeenCalledWith("media");
    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: "clip-a.mp4",
      mediaId: "media-1",
      startTime: 2,
      duration: 4,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("adds a media element by sourceId and falls back to media duration", () => {
    storeMocks.mediaStoreState.mediaItems = [
      {
        id: "media-2",
        name: "clip-b.mp4",
        type: "video",
        file: new File([""], "clip-b.mp4"),
        duration: 9,
      },
    ];

    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    addElementHandler({
      type: "media",
      sourceId: "media-2",
      startTime: 3,
    });

    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: "clip-b.mp4",
      mediaId: "media-2",
      startTime: 3,
      duration: 9,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("adds a text element with defaults when content is missing", () => {
    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    addElementHandler({
      type: "text",
      startTime: 1,
      endTime: 4,
    });

    expect(
      storeMocks.timelineStoreState.findOrCreateTrack
    ).toHaveBeenCalledWith("text");
    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("text-track", {
      type: "text",
      name: "Text",
      content: "Text",
      startTime: 1,
      duration: 3,
      trimStart: 0,
      trimEnd: 0,
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      backgroundColor: "transparent",
      textAlign: "center",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      x: 0.5,
      y: 0.5,
      rotation: 0,
      opacity: 1,
    });
  });

  it("does not add media when referenced source does not exist", () => {
    const warningSpy = vi.spyOn(console, "warn");
    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    addElementHandler({
      type: "image",
      sourceName: "missing-image.png",
      startTime: 0,
      endTime: 3,
    });

    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledWith(
      "[ClaudeTimelineBridge] Media not found:",
      "missing-image.png"
    );
  });
});
