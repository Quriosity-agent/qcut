"use client";

import { useTimelineStore } from "@/stores/timeline-store";
import type { RemotionElement, TimelineElement } from "@/types/timeline";
import { useAsyncMediaItems } from "@/hooks/use-async-media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useEditorStore } from "@/stores/editor-store";
import { TEST_MEDIA_ID } from "@/constants/timeline-constants";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { debugLog } from "@/lib/debug-config";
import { useProjectStore } from "@/stores/project-store";
import { useMcpAppStore } from "@/stores/mcp-app-store";
import { TextElementDragState } from "@/types/editor";
import { FullscreenPreview, PreviewToolbar } from "./preview-panel-components";
import { StickerCanvas } from "./stickers-overlay/StickerCanvas";
import { CaptionsDisplay } from "@/components/captions/captions-display";
import { captureWithFallback } from "@/lib/canvas-utils";
import { useFrameCache } from "@/hooks/use-frame-cache";
import { useEffectsStore } from "@/stores/effects-store";
import {
  parametersToCSSFilters,
  mergeEffectParameters,
} from "@/lib/effects-utils";
import {
  InteractiveElementOverlay,
  ElementTransform,
} from "./interactive-element-overlay";
import { EFFECTS_ENABLED } from "@/config/features";
import {
  PreviewBlurBackground,
  PreviewElementRenderer,
} from "./preview-panel/preview-element-renderer";
import { usePreviewMedia } from "./preview-panel/use-preview-media";
import { usePreviewSizing } from "./preview-panel/use-preview-sizing";
import type { ActiveElement } from "./preview-panel/types";

const MCP_MEDIA_TOOL_NAME = "genfocus-all-in-focus";
const MCP_MEDIA_APP_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GenFocus All-In-Focus</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #19324f, #0f1828 70%);
        color: #eef4ff;
        min-height: 100vh;
        padding: 18px;
        box-sizing: border-box;
      }
      .card {
        width: min(760px, 100%);
        margin: 0 auto;
        border: 1px solid #2a4469;
        border-radius: 14px;
        padding: 20px;
        background: rgba(9, 21, 38, 0.78);
        backdrop-filter: blur(8px);
      }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .subtitle { margin: 0 0 6px; font-size: 13px; color: #52deff; font-family: monospace; }
      p { margin: 0 0 14px; color: #9fb5d8; font-size: 14px; }
      .section { margin-top: 16px; }
      .label {
        margin-bottom: 6px;
        font-size: 13px;
        color: #9fb5d8;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .label .req { color: #ff8ea1; font-size: 11px; }
      .label .opt { color: #6b8ab5; font-size: 11px; }
      .row {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr;
      }
      .row-3 {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr 1fr;
      }
      input[type="text"], input[type="number"], select {
        width: 100%;
        border: 1px solid #2a4469;
        border-radius: 10px;
        padding: 9px 10px;
        background: #13243a;
        color: #eef4ff;
        font-size: 14px;
        box-sizing: border-box;
      }
      input[type="text"]:focus, input[type="number"]:focus, select:focus {
        outline: none;
        border-color: #52deff;
      }
      .range-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .range-wrap input[type="range"] {
        flex: 1;
        accent-color: #52deff;
      }
      .range-val {
        min-width: 36px;
        text-align: right;
        font-size: 14px;
        color: #eef4ff;
        font-variant-numeric: tabular-nums;
      }
      .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
      }
      .toggle-label { font-size: 14px; }
      .toggle {
        position: relative;
        width: 40px;
        height: 22px;
        cursor: pointer;
      }
      .toggle input { opacity: 0; width: 0; height: 0; }
      .toggle .slider {
        position: absolute;
        inset: 0;
        background: #2a4469;
        border-radius: 11px;
        transition: background 0.2s;
      }
      .toggle .slider::after {
        content: "";
        position: absolute;
        left: 3px;
        top: 3px;
        width: 16px;
        height: 16px;
        background: #eef4ff;
        border-radius: 50%;
        transition: transform 0.2s;
      }
      .toggle input:checked + .slider { background: #52deff; }
      .toggle input:checked + .slider::after { transform: translateX(18px); }
      .status {
        margin-top: 12px;
        min-height: 19px;
        font-size: 13px;
        color: #9fb5d8;
      }
      .status.error { color: #ff8ea1; }
      .status.success { color: #34c59b; }
      .apply-btn {
        border: 0;
        border-radius: 10px;
        padding: 10px 20px;
        font-weight: 700;
        font-size: 14px;
        color: #031720;
        background: linear-gradient(135deg, #52deff, #34c59b);
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .apply-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .actions {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
      }
      @media (max-width: 600px) {
        .row, .row-3 { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>GenFocus All-In-Focus</h1>
      <div class="subtitle">fal-ai/genfocus/all-in-focus</div>
      <p>Deblur and restore an image to all-in-focus using AI.</p>

      <div class="section">
        <div class="label">Image URL <span class="req">required</span></div>
        <input type="text" id="image-url" placeholder="https://example.com/photo.jpg" />
      </div>

      <div class="section row">
        <div>
          <div class="label">Inference Steps <span class="opt">8 &ndash; 50</span></div>
          <div class="range-wrap">
            <input type="range" id="steps" min="8" max="50" value="28" />
            <span class="range-val" id="steps-val">28</span>
          </div>
        </div>
        <div>
          <div class="label">Target Long Side <span class="opt">256 &ndash; 2048</span></div>
          <div class="range-wrap">
            <input type="range" id="target-size" min="256" max="2048" step="64" value="512" />
            <span class="range-val" id="target-size-val">512</span>
          </div>
        </div>
      </div>

      <div class="section row-3">
        <div>
          <div class="label">Output Format <span class="opt">optional</span></div>
          <select id="output-format">
            <option value="jpeg" selected>JPEG</option>
            <option value="png">PNG</option>
          </select>
        </div>
        <div>
          <div class="label">Seed <span class="opt">optional</span></div>
          <input type="number" id="seed" placeholder="Random" min="0" />
        </div>
        <div>
          <div class="label">&nbsp;</div>
          <div class="toggle-row">
            <span class="toggle-label">Safety Checker</span>
            <label class="toggle">
              <input type="checkbox" id="safety-checker" checked />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="status" id="status">Ready.</div>
      <div class="actions">
        <button type="button" id="confirm-btn" class="apply-btn">Confirm &amp; Run</button>
      </div>
    </main>
    <script>
      const imageUrlInput = document.getElementById("image-url");
      const stepsInput = document.getElementById("steps");
      const stepsVal = document.getElementById("steps-val");
      const targetSizeInput = document.getElementById("target-size");
      const targetSizeVal = document.getElementById("target-size-val");
      const outputFormatSelect = document.getElementById("output-format");
      const seedInput = document.getElementById("seed");
      const safetyChecker = document.getElementById("safety-checker");
      const confirmBtn = document.getElementById("confirm-btn");
      const status = document.getElementById("status");

      const projectId = "__PROJECT_ID__";
      const apiBaseUrl = "http://127.0.0.1:8765";

      function setStatus(message, type) {
        try {
          if (!status) return;
          status.textContent = message;
          status.className = "status";
          if (type === "error") status.classList.add("error");
          if (type === "success") status.classList.add("success");
        } catch (e) {}
      }

      stepsInput?.addEventListener("input", () => {
        try { if (stepsVal) stepsVal.textContent = stepsInput.value; } catch (e) {}
      });

      targetSizeInput?.addEventListener("input", () => {
        try { if (targetSizeVal) targetSizeVal.textContent = targetSizeInput.value; } catch (e) {}
      });

      confirmBtn?.addEventListener("click", async () => {
        try {
          const imageUrl = (imageUrlInput?.value || "").trim();
          if (!imageUrl) {
            setStatus("Image URL is required.", "error");
            imageUrlInput?.focus();
            return;
          }

          confirmBtn.disabled = true;
          setStatus("Submitting to GenFocus...", "");

          const payload = {
            image_url: imageUrl,
            num_inference_steps: Number.parseInt(stepsInput?.value || "28", 10),
            target_long_side: Number.parseInt(targetSizeInput?.value || "512", 10),
            output_format: outputFormatSelect?.value || "jpeg",
            enable_safety_checker: safetyChecker?.checked ?? true,
          };

          const seedVal = (seedInput?.value || "").trim();
          if (seedVal !== "") {
            const seedNum = Number.parseInt(seedVal, 10);
            if (Number.isFinite(seedNum) && seedNum >= 0) {
              payload.seed = seedNum;
            }
          }

          const response = await fetch(
            apiBaseUrl + "/api/claude/project/" + projectId + "/settings",
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ genfocus: payload }),
            }
          );

          if (!response.ok) {
            throw new Error("Request failed with status " + response.status);
          }

          await response.json();
          setStatus("Configuration confirmed and sent to QCut.", "success");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to submit";
          setStatus(message, "error");
        } finally {
          if (confirmBtn) confirmBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

function buildMcpMediaAppHtml({ projectId }: { projectId: string | null }): string {
  try {
    const resolvedProjectId = (projectId || "default").trim() || "default";
    return MCP_MEDIA_APP_TEMPLATE.replace(/__PROJECT_ID__/g, resolvedProjectId);
  } catch {
    return MCP_MEDIA_APP_TEMPLATE.replace(/__PROJECT_ID__/g, "default");
  }
}

/** Compute the aggregate CSS filter string for an element's enabled effects. */
function useEffectsRendering(elementId: string | null, enabled = false) {
  const getElementEffects = useEffectsStore((state) => state.getElementEffects);

  const effects = useMemo(() => {
    if (!enabled || !elementId) {
      return [];
    }
    const elementEffects = getElementEffects(elementId);
    return elementEffects;
  }, [enabled, elementId, getElementEffects]);

  const filterStyle = useMemo(() => {
    if (!enabled || !effects || effects.length === 0) {
      return "";
    }

    try {
      // Filter for enabled effects first
      const enabledEffects = effects.filter((e) => e.enabled);

      // Guard against zero enabled effects
      if (enabledEffects.length === 0) {
        return "";
      }

      // Merge all active effect parameters
      const mergedParams = mergeEffectParameters(
        ...enabledEffects.map((e) => e.parameters)
      );

      const cssFilter = parametersToCSSFilters(mergedParams);
      return cssFilter;
    } catch (error) {
      return "";
    }
  }, [enabled, effects]);

  // Check if there are any enabled effects, not just any effects
  const hasEnabledEffects = effects?.some?.((e) => e.enabled) ?? false;

  return { filterStyle, hasEffects: hasEnabledEffects };
}

/** Canvas preview of the timeline — renders media, text, stickers, captions, and effects. */
export function PreviewPanel() {
  const {
    tracks,
    getTotalDuration,
    updateTextElement,
    updateElementPosition,
    updateElementSize,
    updateElementRotation,
  } = useTimelineStore();
  const {
    mediaItems,
    loading: mediaItemsLoading,
    error: mediaItemsError,
  } = useAsyncMediaItems();
  const { currentTime, toggle, setCurrentTime, isPlaying } = usePlaybackStore();
  const { canvasSize } = useEditorStore();
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Canvas refs for frame caching - non-interfering
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastSeekEventTimeRef = useRef<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { activeProject } = useProjectStore();
  const externalHtml = useMcpAppStore((state) => state.activeHtml);
  const externalToolName = useMcpAppStore((state) => state.toolName);
  const localMcpActive = useMcpAppStore((state) => state.localMcpActive);
  const setMcpApp = useMcpAppStore((state) => state.setMcpApp);
  const clearMcpApp = useMcpAppStore((state) => state.clearMcpApp);
  const setLocalMcpActive = useMcpAppStore((state) => state.setLocalMcpActive);

  // Local MCP: derive HTML fresh from template every render (auto-reload on HMR)
  // External MCP: use stored HTML from IPC
  const activeHtml = localMcpActive
    ? buildMcpMediaAppHtml({ projectId: activeProject?.id ?? null })
    : externalHtml;
  const activeToolName = localMcpActive ? MCP_MEDIA_TOOL_NAME : externalToolName;
  const isMcpMediaAppActive = localMcpActive;
  const previewDimensions = usePreviewSizing({
    containerRef,
    canvasSize,
    isExpanded,
  });
  const [dragState, setDragState] = useState<TextElementDragState>({
    isDragging: false,
    elementId: null,
    trackId: null,
    startX: 0,
    startY: 0,
    initialElementX: 0,
    initialElementY: 0,
    currentX: 0,
    currentY: 0,
    elementWidth: 0,
    elementHeight: 0,
  });

  // State for selected element (for interactive overlay)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );

  // Frame caching - non-intrusive addition
  const {
    getCachedFrame,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    preRenderNearbyFrames,
  } = useFrameCache({
    maxCacheSize: 300,
    cacheResolution: 30,
    persist: true,
  });

  useEffect(() => {
    const mcpApi = window.electronAPI?.mcp;
    if (!mcpApi?.onAppHtml) {
      return;
    }

    const handleAppHtml = (payload: { html: string; toolName?: string }) => {
      try {
        if (!payload || typeof payload.html !== "string") {
          return;
        }

        const html = payload.html.trim();
        if (!html) {
          return;
        }

        setMcpApp({
          html,
          toolName:
            typeof payload.toolName === "string" ? payload.toolName : null,
        });
      } catch {
        // Ignore malformed payloads from external tools.
      }
    };

    try {
      mcpApi.onAppHtml(handleAppHtml);
    } catch {
      return;
    }

    return () => {
      try {
        mcpApi.removeListeners?.();
      } catch {
        // Listener cleanup best-effort
      }
    };
  }, [setMcpApp]);

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.isDragging) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;

      const scaleRatio = previewDimensions.width / canvasSize.width;
      const newX = dragState.initialElementX + deltaX / scaleRatio;
      const newY = dragState.initialElementY + deltaY / scaleRatio;

      const halfWidth = dragState.elementWidth / scaleRatio / 2;
      const halfHeight = dragState.elementHeight / scaleRatio / 2;

      const constrainedX = Math.max(
        -canvasSize.width / 2 + halfWidth,
        Math.min(canvasSize.width / 2 - halfWidth, newX)
      );
      const constrainedY = Math.max(
        -canvasSize.height / 2 + halfHeight,
        Math.min(canvasSize.height / 2 - halfHeight, newY)
      );

      setDragState((prev) => ({
        ...prev,
        currentX: constrainedX,
        currentY: constrainedY,
      }));
    };

    const handleMouseUp = () => {
      if (dragState.isDragging && dragState.trackId && dragState.elementId) {
        // Find element type to use appropriate update method
        const track = tracks.find((t) => t.id === dragState.trackId);
        const el = track?.elements.find((e) => e.id === dragState.elementId);
        if (el?.type === "text") {
          updateTextElement(dragState.trackId, dragState.elementId, {
            x: dragState.currentX,
            y: dragState.currentY,
          });
        } else {
          updateElementPosition(dragState.elementId, {
            x: dragState.currentX,
            y: dragState.currentY,
          });
        }
      }
      setDragState((prev) => ({ ...prev, isDragging: false }));
    };

    if (dragState.isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [
    dragState,
    previewDimensions,
    canvasSize,
    updateTextElement,
    tracks,
    updateElementPosition,
  ]);

  const handleTextMouseDown = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      element: Pick<TimelineElement, "id" | "x" | "y">,
      trackId: string
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = e.currentTarget.getBoundingClientRect();

      setDragState({
        isDragging: true,
        elementId: element.id,
        trackId,
        startX: e.clientX,
        startY: e.clientY,
        initialElementX: element.x ?? 0,
        initialElementY: element.y ?? 0,
        currentX: element.x ?? 0,
        currentY: element.y ?? 0,
        elementWidth: rect.width,
        elementHeight: rect.height,
      });
    },
    []
  );

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleMcpMediaApp = useCallback(() => {
    try {
      if (localMcpActive) {
        setLocalMcpActive(false);
        return;
      }
      // Clear any external MCP app and activate local MCP
      setLocalMcpActive(true);
    } catch {
      // Ignore local MCP toggle errors to avoid blocking normal preview.
    }
  }, [localMcpActive, setLocalMcpActive]);

  const handleToggleMcpKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      try {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        toggleMcpMediaApp();
      } catch {
        // Keep keyboard handling resilient for the preview controls.
      }
    },
    [toggleMcpMediaApp]
  );

  // Helper function to capture current preview frame
  const captureCurrentFrame = useCallback(async () => {
    if (
      !previewRef.current ||
      previewDimensions.width === 0 ||
      previewDimensions.height === 0
    ) {
      return null;
    }

    try {
      const imageData = await captureWithFallback(previewRef.current, {
        width: previewDimensions.width,
        height: previewDimensions.height,
        backgroundColor:
          activeProject?.backgroundType === "blur"
            ? "transparent"
            : activeProject?.backgroundColor || "#000000",
      });

      return imageData;
    } catch (error) {
      return null;
    }
  }, [previewDimensions, activeProject]);

  useEffect(() => {
    const handlePlaybackSeek = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && typeof detail.time === "number") {
        lastSeekEventTimeRef.current = detail.time;
      }
    };

    window.addEventListener(
      "playback-seek",
      handlePlaybackSeek as EventListener
    );
    return () =>
      window.removeEventListener(
        "playback-seek",
        handlePlaybackSeek as EventListener
      );
  }, []);

  const hasAnyElements = tracks.some((track) => track.elements.length > 0);
  const getActiveElements = useCallback((): ActiveElement[] => {
    try {
      const activeElements: ActiveElement[] = [];

      for (const track of tracks) {
        for (const element of track.elements) {
          if (element.hidden) {
            continue;
          }

          const elementStart = element.startTime;
          const elementEnd =
            element.startTime +
            (element.duration - element.trimStart - element.trimEnd);

          if (currentTime < elementStart || currentTime >= elementEnd) {
            continue;
          }

          let mediaItem = null;
          if (element.type === "media") {
            mediaItem =
              element.mediaId === TEST_MEDIA_ID
                ? null
                : (mediaItems.find((item) => item.id === element.mediaId) ??
                  null);
          }

          activeElements.push({ element, track, mediaItem });
        }
      }

      return activeElements;
    } catch {
      return [];
    }
  }, [tracks, currentTime, mediaItems]);

  const activeElements = useMemo(
    () => getActiveElements(),
    [getActiveElements]
  );

  const {
    captionSegments,
    blurBackgroundElements,
    videoSourcesById,
    blurBackgroundSource,
    currentMediaElement,
  } = usePreviewMedia({
    activeElements,
    mediaItems,
    activeProject,
  });

  const { filterStyle, hasEffects: hasEnabledEffects } = useEffectsRendering(
    currentMediaElement?.element.id ?? null,
    EFFECTS_ENABLED
  );

  useEffect(() => {
    const seekTime = lastSeekEventTimeRef.current;
    const didSeek =
      typeof seekTime === "number" && Math.abs(seekTime - currentTime) < 0.001;

    if (didSeek) {
      lastSeekEventTimeRef.current = null;
      return;
    }
  }, [currentTime]);

  // Warm cache during idle time
  useEffect(() => {
    if (!isPlaying && previewRef.current) {
      const warmCache = () => {
        preRenderNearbyFrames(
          currentTime,
          async (time) => {
            if (!previewRef.current) throw new Error("No preview element");
            // Safety: only capture current-time frame to avoid mismatched cache
            const tolerance = 1 / 30;
            if (Math.abs(time - currentTime) > tolerance) {
              throw new Error("Cannot capture non-current time safely");
            }
            const imageData = await captureWithFallback(previewRef.current, {
              width: previewDimensions.width,
              height: previewDimensions.height,
              backgroundColor:
                activeProject?.backgroundType === "blur"
                  ? "transparent"
                  : activeProject?.backgroundColor || "#000000",
            });
            if (!imageData) throw new Error("Failed to capture frame");
            return imageData;
          },
          3,
          tracks,
          mediaItems,
          activeProject
        );
      };

      const timeoutId = setTimeout(warmCache, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [
    currentTime,
    isPlaying,
    preRenderNearbyFrames,
    previewDimensions.width,
    previewDimensions.height,
    activeProject?.backgroundColor,
    activeProject?.backgroundType,
    tracks,
    mediaItems,
    activeProject,
  ]);

  // Handler for transform updates from interactive overlay
  const handleTransformUpdate = useCallback(
    (elementId: string, transform: ElementTransform) => {
      const element = activeElements.find((el) => el.element.id === elementId);
      if (!element) return;

      // Use generic element update methods that work for all element types
      // Update position if changed
      if (transform.x !== undefined || transform.y !== undefined) {
        updateElementPosition(elementId, {
          x: transform.x,
          y: transform.y,
        });
      }

      // Update size if changed
      if (transform.width !== undefined || transform.height !== undefined) {
        updateElementSize(elementId, {
          width: transform.width,
          height: transform.height,
        });
      }

      // Update rotation if changed
      if (transform.rotation !== undefined) {
        updateElementRotation(elementId, transform.rotation);
      }
    },
    [
      activeElements,
      updateElementPosition,
      updateElementSize,
      updateElementRotation,
    ]
  );
  const handleElementResize = useCallback(
    ({
      elementId,
      width,
      height,
    }: {
      elementId: string;
      width: number;
      height: number;
    }) => {
      try {
        updateElementSize(elementId, { width, height });
      } catch {
        // keep preview responsive even if a resize update fails
      }
    },
    [updateElementSize]
  );

  const loggedRemotionElementsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const elementData of activeElements) {
      if (elementData.element.type !== "remotion") {
        continue;
      }
      if (loggedRemotionElementsRef.current.has(elementData.element.id)) {
        continue;
      }

      loggedRemotionElementsRef.current.add(elementData.element.id);
      const remotionElement = elementData.element as RemotionElement;
      debugLog("[REMOTION] Detected Remotion element", {
        elementId: remotionElement.id,
        componentId: remotionElement.componentId,
      });
    }
  }, [activeElements]);

  const renderBlurBackground = useCallback(
    () => (
      <PreviewBlurBackground
        activeProject={activeProject}
        blurBackgroundElements={blurBackgroundElements}
        blurBackgroundSource={blurBackgroundSource}
        currentMediaElement={currentMediaElement}
        filterStyle={filterStyle}
        hasEnabledEffects={hasEnabledEffects}
      />
    ),
    [
      activeProject,
      blurBackgroundElements,
      blurBackgroundSource,
      currentMediaElement,
      filterStyle,
      hasEnabledEffects,
    ]
  );

  const renderElement = useCallback(
    (elementData: ActiveElement, index: number) => (
      <PreviewElementRenderer
        key={`${elementData.element.id}-${elementData.track.id}`}
        elementData={elementData}
        index={index}
        previewDimensions={previewDimensions}
        canvasSize={canvasSize}
        currentTime={currentTime}
        filterStyle={filterStyle}
        hasEnabledEffects={hasEnabledEffects}
        videoSourcesById={videoSourcesById}
        currentMediaElement={currentMediaElement}
        dragState={dragState}
        isPlaying={isPlaying}
        activeProject={activeProject}
        onTextMouseDown={handleTextMouseDown}
        onElementSelect={({ elementId }) => setSelectedElementId(elementId)}
        onElementResize={handleElementResize}
      />
    ),
    [
      activeProject,
      canvasSize,
      currentMediaElement,
      currentTime,
      dragState,
      filterStyle,
      handleElementResize,
      handleTextMouseDown,
      hasEnabledEffects,
      isPlaying,
      previewDimensions,
      videoSourcesById,
    ]
  );

  // Enhanced sync check: Timeline elements exist but no media items loaded
  // If timeline has elements but media list is still empty, prefer showing normal UI and let
  // individual elements render placeholders as needed. Avoid global warning screen.

  // Handle media loading states
  if (mediaItemsError) {
    return (
      <div
        className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm"
        data-testid="preview-panel"
      >
        <div className="flex-1 flex items-center justify-center p-3">
          <div className="text-center">
            <div className="text-red-500 mb-2">Failed to load media items</div>
            <div className="text-sm text-muted-foreground">
              {mediaItemsError.message}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mediaItemsLoading) {
    return (
      <div
        className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm"
        data-testid="preview-panel"
      >
        <div className="flex-1 flex items-center justify-center p-3">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            <span>Loading preview...</span>
          </div>
        </div>
      </div>
    );
  }

  if (activeHtml) {
    return (
      <div
        className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm"
        data-testid="preview-panel"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <p className="text-sm font-medium text-foreground truncate">
            {activeToolName ? `MCP App: ${activeToolName}` : "MCP App"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
              onClick={toggleMcpMediaApp}
              onKeyDown={handleToggleMcpKeyDown}
              aria-label="Switch to MCP media app"
            >
              {isMcpMediaAppActive ? "Video Preview" : "MCP Media App"}
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
              onClick={clearMcpApp}
              onKeyDown={(event) => {
                try {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  clearMcpApp();
                } catch {
                  // Keep dismiss action safe even if key handling fails.
                }
              }}
              aria-label="Return to normal preview"
            >
              Return to Preview
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-3">
          <iframe
            title={activeToolName || "MCP app preview"}
            srcDoc={activeHtml}
            sandbox="allow-scripts allow-forms"
            className="h-full w-full border rounded bg-background"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm"
        data-testid="preview-panel"
      >
        <div className="flex items-center justify-end px-3 py-2 border-b">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
            onClick={toggleMcpMediaApp}
            onKeyDown={handleToggleMcpKeyDown}
            aria-label="Switch to MCP media app"
          >
            MCP Media App
          </button>
        </div>
        <div
          ref={containerRef}
          className="flex-1 flex flex-col items-center justify-center p-3 min-h-0 min-w-0"
        >
          <div className="flex-1" />
          {hasAnyElements ? (
            <div
              ref={previewRef}
              className="relative overflow-hidden border"
              style={{
                width: previewDimensions.width || canvasSize.width,
                height: previewDimensions.height || canvasSize.height,
                backgroundColor:
                  activeProject?.backgroundType === "blur"
                    ? "transparent"
                    : activeProject?.backgroundColor || "#000000",
              }}
            >
              {renderBlurBackground()}
              {activeElements.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  No elements at current time
                </div>
              ) : (
                activeElements.map((elementData, index) =>
                  renderElement(elementData, index)
                )
              )}
              {activeProject?.backgroundType === "blur" &&
                blurBackgroundElements.length === 0 &&
                activeElements.length > 0 && (
                  <div className="absolute bottom-2 left-2 right-2 bg-background/70 text-foreground text-xs p-2 rounded">
                    Add a video or image to use blur background
                  </div>
                )}

              {/* Sticker overlay layer - renders on top of everything */}
              <StickerCanvas
                className="absolute inset-0"
                disabled={isExpanded}
              />

              {/* Captions overlay - renders on top of stickers */}
              <CaptionsDisplay
                segments={captionSegments}
                currentTime={currentTime}
                isVisible={captionSegments.length > 0}
                className="absolute inset-0 pointer-events-none"
              />

              {/* Interactive element overlays for elements with effects */}
              {EFFECTS_ENABLED &&
                activeElements.map((elementData) => (
                  <InteractiveElementOverlay
                    key={`${elementData.element.id}-${elementData.track.id}`}
                    element={elementData.element}
                    isSelected={selectedElementId === elementData.element.id}
                    canvasSize={canvasSize}
                    previewDimensions={previewDimensions}
                    onTransformUpdate={handleTransformUpdate}
                  />
                ))}

              {/* Hidden canvas for frame caching - non-visual */}
              <canvas
                ref={canvasRef}
                className="hidden"
                width={previewDimensions.width}
                height={previewDimensions.height}
              />
              <canvas
                ref={cacheCanvasRef}
                className="hidden"
                width={previewDimensions.width}
                height={previewDimensions.height}
              />
            </div>
          ) : null}

          <div className="flex-1" />

          <PreviewToolbar
            hasAnyElements={hasAnyElements}
            onToggleExpanded={toggleExpanded}
            isExpanded={isExpanded}
            currentTime={currentTime}
            setCurrentTime={setCurrentTime}
            toggle={toggle}
            getTotalDuration={getTotalDuration}
          />
        </div>
      </div>

      {isExpanded && (
        <FullscreenPreview
          previewDimensions={previewDimensions}
          activeProject={activeProject}
          renderBlurBackground={renderBlurBackground}
          activeElements={activeElements}
          renderElement={renderElement}
          blurBackgroundElements={blurBackgroundElements}
          hasAnyElements={hasAnyElements}
          toggleExpanded={toggleExpanded}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          toggle={toggle}
          getTotalDuration={getTotalDuration}
        />
      )}
    </>
  );
}
