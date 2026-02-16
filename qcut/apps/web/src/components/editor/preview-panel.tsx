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

const MCP_MEDIA_TOOL_NAME = "personaplex";
const MCP_MEDIA_APP_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PersonaPlex</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #1a1a2e, #0f0f1a 70%);
        color: #eef4ff;
        min-height: 100vh;
        padding: 18px;
        box-sizing: border-box;
      }
      .card {
        width: min(760px, 100%);
        margin: 0 auto;
        border: 1px solid #2a2a5a;
        border-radius: 14px;
        padding: 20px;
        background: rgba(12, 12, 30, 0.82);
        backdrop-filter: blur(8px);
      }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .subtitle { margin: 0 0 6px; font-size: 13px; color: #a78bfa; font-family: monospace; }
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
      input[type="text"], input[type="number"], select, textarea {
        width: 100%;
        border: 1px solid #2a2a5a;
        border-radius: 10px;
        padding: 9px 10px;
        background: #13132a;
        color: #eef4ff;
        font-size: 14px;
        box-sizing: border-box;
        font-family: inherit;
      }
      textarea {
        resize: vertical;
        min-height: 72px;
      }
      input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
        outline: none;
        border-color: #a78bfa;
      }
      .range-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .range-wrap input[type="range"] {
        flex: 1;
        accent-color: #a78bfa;
      }
      .range-val {
        min-width: 42px;
        text-align: right;
        font-size: 14px;
        color: #eef4ff;
        font-variant-numeric: tabular-nums;
      }
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
        color: #fff;
        background: linear-gradient(135deg, #a78bfa, #6d28d9);
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
      .result-area {
        margin-top: 16px;
        display: none;
      }
      .result-area.visible { display: block; }
      .result-audio {
        margin-top: 8px;
      }
      .result-audio audio {
        width: 100%;
        border-radius: 10px;
      }
      .result-text {
        margin-top: 10px;
        padding: 12px;
        background: #13132a;
        border: 1px solid #2a2a5a;
        border-radius: 10px;
        font-size: 14px;
        color: #eef4ff;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      .result-meta {
        margin-top: 8px;
        font-size: 12px;
        color: #6b8ab5;
      }
      .voice-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      .voice-group-label {
        font-size: 11px;
        color: #6b8ab5;
        padding: 4px 0 2px;
        grid-column: 1 / -1;
      }
      @media (max-width: 600px) {
        .row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>PersonaPlex</h1>
      <div class="subtitle">fal-ai/personaplex</div>
      <p>Real-time speech-to-speech AI with persona control. Provide audio input and a persona prompt to generate a conversational response.</p>

      <div class="section">
        <div class="label">Audio URL <span class="req">required</span></div>
        <input type="text" id="audio-url" placeholder="https://example.com/input-speech.wav" />
      </div>

      <div class="section">
        <div class="label">Persona Prompt <span class="opt">optional</span></div>
        <textarea id="prompt" placeholder="You are a wise and friendly teacher who explains concepts clearly and patiently..." rows="3"></textarea>
      </div>

      <div class="section row">
        <div>
          <div class="label">Voice <span class="opt">default: NATF2</span></div>
          <select id="voice">
            <optgroup label="Natural Female">
              <option value="NATF0">NATF0</option>
              <option value="NATF1">NATF1</option>
              <option value="NATF2" selected>NATF2</option>
              <option value="NATF3">NATF3</option>
            </optgroup>
            <optgroup label="Natural Male">
              <option value="NATM0">NATM0</option>
              <option value="NATM1">NATM1</option>
              <option value="NATM2">NATM2</option>
              <option value="NATM3">NATM3</option>
            </optgroup>
            <optgroup label="Variety Female">
              <option value="VARF0">VARF0</option>
              <option value="VARF1">VARF1</option>
              <option value="VARF2">VARF2</option>
              <option value="VARF3">VARF3</option>
              <option value="VARF4">VARF4</option>
            </optgroup>
            <optgroup label="Variety Male">
              <option value="VARM0">VARM0</option>
              <option value="VARM1">VARM1</option>
              <option value="VARM2">VARM2</option>
              <option value="VARM3">VARM3</option>
              <option value="VARM4">VARM4</option>
            </optgroup>
          </select>
        </div>
        <div>
          <div class="label">Seed <span class="opt">optional</span></div>
          <input type="number" id="seed" placeholder="Random" min="0" />
        </div>
      </div>

      <div class="section row">
        <div>
          <div class="label">Audio Temperature <span class="opt">0 &ndash; 2</span></div>
          <div class="range-wrap">
            <input type="range" id="temp-audio" min="0" max="2" step="0.05" value="0.8" />
            <span class="range-val" id="temp-audio-val">0.80</span>
          </div>
        </div>
        <div>
          <div class="label">Text Temperature <span class="opt">0 &ndash; 2</span></div>
          <div class="range-wrap">
            <input type="range" id="temp-text" min="0" max="2" step="0.05" value="0.7" />
            <span class="range-val" id="temp-text-val">0.70</span>
          </div>
        </div>
      </div>

      <div class="section row">
        <div>
          <div class="label">Top-K Audio <span class="opt">1 &ndash; 2048</span></div>
          <div class="range-wrap">
            <input type="range" id="topk-audio" min="1" max="2048" step="1" value="250" />
            <span class="range-val" id="topk-audio-val">250</span>
          </div>
        </div>
        <div>
          <div class="label">Top-K Text <span class="opt">1 &ndash; 1000</span></div>
          <div class="range-wrap">
            <input type="range" id="topk-text" min="1" max="1000" step="1" value="25" />
            <span class="range-val" id="topk-text-val">25</span>
          </div>
        </div>
      </div>

      <div class="status" id="status">Ready.</div>
      <div class="actions">
        <button type="button" id="confirm-btn" class="apply-btn">Generate</button>
      </div>

      <div class="result-area" id="result-area">
        <div class="label">Response</div>
        <div class="result-audio" id="result-audio"></div>
        <div class="result-text" id="result-text"></div>
        <div class="result-meta" id="result-meta"></div>
      </div>
    </main>
    <script>
      const audioUrlInput = document.getElementById("audio-url");
      const promptInput = document.getElementById("prompt");
      const voiceSelect = document.getElementById("voice");
      const seedInput = document.getElementById("seed");
      const tempAudioInput = document.getElementById("temp-audio");
      const tempAudioVal = document.getElementById("temp-audio-val");
      const tempTextInput = document.getElementById("temp-text");
      const tempTextVal = document.getElementById("temp-text-val");
      const topkAudioInput = document.getElementById("topk-audio");
      const topkAudioVal = document.getElementById("topk-audio-val");
      const topkTextInput = document.getElementById("topk-text");
      const topkTextVal = document.getElementById("topk-text-val");
      const confirmBtn = document.getElementById("confirm-btn");
      const statusEl = document.getElementById("status");
      const resultArea = document.getElementById("result-area");
      const resultAudio = document.getElementById("result-audio");
      const resultText = document.getElementById("result-text");
      const resultMeta = document.getElementById("result-meta");

      const projectId = __PROJECT_ID_JSON__;
      const apiBaseUrl = "http://127.0.0.1:8765";

      function setStatus(message, type) {
        try {
          if (!statusEl) return;
          statusEl.textContent = message;
          statusEl.className = "status";
          if (type === "error") statusEl.classList.add("error");
          if (type === "success") statusEl.classList.add("success");
        } catch (e) {}
      }

      tempAudioInput?.addEventListener("input", () => {
        try { if (tempAudioVal) tempAudioVal.textContent = Number.parseFloat(tempAudioInput.value).toFixed(2); } catch (e) {}
      });
      tempTextInput?.addEventListener("input", () => {
        try { if (tempTextVal) tempTextVal.textContent = Number.parseFloat(tempTextInput.value).toFixed(2); } catch (e) {}
      });
      topkAudioInput?.addEventListener("input", () => {
        try { if (topkAudioVal) topkAudioVal.textContent = topkAudioInput.value; } catch (e) {}
      });
      topkTextInput?.addEventListener("input", () => {
        try { if (topkTextVal) topkTextVal.textContent = topkTextInput.value; } catch (e) {}
      });

      confirmBtn?.addEventListener("click", async () => {
        try {
          const audioUrl = (audioUrlInput?.value || "").trim();
          if (!audioUrl) {
            setStatus("Audio URL is required.", "error");
            audioUrlInput?.focus();
            return;
          }

          confirmBtn.disabled = true;
          setStatus("Generating speech response...", "");
          resultArea?.classList.remove("visible");

          const payload = {
            audio_url: audioUrl,
            voice: voiceSelect?.value || "NATF2",
            temperature_audio: Number.parseFloat(tempAudioInput?.value || "0.8"),
            temperature_text: Number.parseFloat(tempTextInput?.value || "0.7"),
            top_k_audio: Number.parseInt(topkAudioInput?.value || "250", 10),
            top_k_text: Number.parseInt(topkTextInput?.value || "25", 10),
          };

          const prompt = (promptInput?.value || "").trim();
          if (prompt) {
            payload.prompt = prompt;
          }

          const seedVal = (seedInput?.value || "").trim();
          if (seedVal !== "") {
            const seedNum = Number.parseInt(seedVal, 10);
            if (Number.isFinite(seedNum) && seedNum >= 0) {
              payload.seed = seedNum;
            }
          }

          const response = await fetch(
            apiBaseUrl + "/api/claude/personaplex/generate",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(errBody || "Request failed: " + response.status);
          }

          const result = await response.json();

          if (resultArea) resultArea.classList.add("visible");
          if (result.audio && result.audio.url && resultAudio) {
            resultAudio.textContent = "";
            var audioEl = document.createElement("audio");
            audioEl.controls = true;
            audioEl.autoplay = true;
            audioEl.src = result.audio.url;
            audioEl.style.cssText = "width:100%;border-radius:10px;";
            if (result.text) {
              try {
                var vtt = "WEBVTT\\n\\n00:00:00.000 --> 99:59:59.999\\n" + result.text;
                var trackBlob = new Blob([vtt], { type: "text/vtt" });
                var trackUrl = URL.createObjectURL(trackBlob);
                var track = document.createElement("track");
                track.kind = "captions";
                track.srclang = "en";
                track.label = "Response";
                track.src = trackUrl;
                track.default = true;
                audioEl.appendChild(track);
              } catch (e) {}
            }
            resultAudio.appendChild(audioEl);
          }
          if (result.text && resultText) {
            resultText.textContent = result.text;
          }
          const meta = [];
          if (result.duration != null) meta.push("Duration: " + Number(result.duration).toFixed(2) + "s");
          if (result.seed != null) meta.push("Seed: " + result.seed);
          if (resultMeta) resultMeta.textContent = meta.join(" | ");

          setStatus("Response received!", "success");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to generate";
          setStatus(message, "error");
        } finally {
          if (confirmBtn) confirmBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

function buildMcpMediaAppHtml({
  projectId,
}: {
  projectId: string | null;
}): string {
  try {
    const resolvedProjectId = (projectId || "default").trim() || "default";
    const safeProjectId = JSON.stringify(resolvedProjectId);
    return MCP_MEDIA_APP_TEMPLATE.replace(
      /__PROJECT_ID_JSON__/g,
      safeProjectId
    );
  } catch {
    return MCP_MEDIA_APP_TEMPLATE.replace(
      /__PROJECT_ID_JSON__/g,
      JSON.stringify("default")
    );
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
  const activeToolName = localMcpActive
    ? MCP_MEDIA_TOOL_NAME
    : externalToolName;
  const isMcpMediaAppActive = localMcpActive;
  debugLog(
    "[MCP] render — localMcpActive:",
    localMcpActive,
    "activeHtml length:",
    activeHtml?.length ?? 0,
    "toolName:",
    activeToolName
  );
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
      debugLog("[MCP] toggle clicked, localMcpActive:", localMcpActive);
      if (localMcpActive) {
        setLocalMcpActive(false);
        debugLog("[MCP] switched OFF");
        return;
      }
      setLocalMcpActive(true);
      debugLog("[MCP] switched ON");
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
            key={activeHtml?.length ?? 0}
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
