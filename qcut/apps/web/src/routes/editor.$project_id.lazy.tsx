import React, { useEffect, useRef } from "react";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { EditorHeader } from "@/components/editor-header";
import { usePanelStore } from "@/stores/panel-store";
import { EditorProvider } from "@/components/editor-provider";
import { useProjectStore, NotFoundError } from "@/stores/project-store";
import { usePlaybackControls } from "@/hooks/use-playback-controls";
import { Onboarding } from "@/components/onboarding";
import { debugError, debugLog } from "@/lib/debug-config";
import "@/lib/debug-sticker-overlay"; // Load debug utilities
import "@/lib/sticker-test-helper"; // Load sticker test helper
import "@/lib/sticker-persistence-debug"; // Load persistence debug
import {
  DefaultLayout,
  MediaLayout,
  InspectorLayout,
  VerticalPreviewLayout,
} from "@/components/editor/panel-layouts";

export const Route = createLazyFileRoute("/editor/$project_id")({
  component: EditorPage,
});

function EditorPage() {
  const navigate = useNavigate();
  const { project_id } = Route.useParams();

  const {
    activeProject,
    loadProject,
    createNewProject,
    isInvalidProjectId,
    markProjectIdAsInvalid,
  } = useProjectStore();

  // Track current load promise to handle concurrent loads properly
  const currentLoadPromiseRef = useRef<Promise<void> | null>(null);
  // Track which project_id is currently being loaded to avoid duplicate loads
  const inFlightProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    const init = async () => {
      debugLog(`[Editor] init called for project: ${project_id}`);

      if (!project_id || abortController.signal.aborted) {
        debugLog("[Editor] Early return - no project_id or aborted");
        return;
      }

      if (activeProject?.id === project_id) {
        debugLog(
          `[Editor] Early return - project already loaded: ${activeProject.id}`
        );
        return;
      }

      if (isInvalidProjectId(project_id)) {
        debugLog("[Editor] Early return - invalid project ID");
        return;
      }

      // Prevent duplicate loads for the same project_id
      if (inFlightProjectIdRef.current === project_id) {
        debugLog(
          `[Editor] Early return - already loading project: ${project_id}`
        );
        return;
      }

      // Wait for any previous load to complete before starting a new one
      if (currentLoadPromiseRef.current) {
        if (inFlightProjectIdRef.current === project_id) {
          debugLog(
            `[Editor] Early return - already initializing same project: ${project_id}`
          );
          return;
        }
        debugLog(
          `[Editor] Waiting for previous load to complete before loading: ${project_id}`
        );
        try {
          await currentLoadPromiseRef.current;
        } catch {
          // Previous load handled its error path; continue.
        }
        // Check if we were aborted while waiting
        if (abortController.signal.aborted) {
          debugLog("[Editor] Aborted while waiting for previous load");
          return;
        }
        // Re-check after waiting in case the previous load already satisfied this project
        const latestActiveProjectId =
          useProjectStore.getState().activeProject?.id;
        if (
          latestActiveProjectId === project_id ||
          inFlightProjectIdRef.current === project_id
        ) {
          debugLog(
            `[Editor] Early return - project became loaded while waiting: ${project_id}`
          );
          return;
        }
      }

      debugLog(`[Editor] Starting project load: ${project_id}`);

      // Create load promise for this specific project
      inFlightProjectIdRef.current = project_id;
      const loadPromise = (async () => {
        try {
          await loadProject(project_id);
          debugLog(`[Editor] Project load complete: ${project_id}`);

          if (abortController.signal.aborted) {
            debugLog(`[Editor] Load completed but was aborted: ${project_id}`);
            return;
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            debugLog(`[Editor] Load failed but was aborted: ${project_id}`);
            return;
          }

          const isNotFound = error instanceof NotFoundError;
          if (isNotFound) {
            markProjectIdAsInvalid(project_id);
            try {
              const newId = await createNewProject("Untitled Project");
              if (abortController.signal.aborted) return;

              navigate({
                to: "/editor/$project_id",
                params: { project_id: newId },
              });
            } catch (e) {
              debugError(
                "[Editor] createNewProject failed after NotFoundError",
                e
              );
            }
          } else {
            // Re-throw to allow retries on non-not-found errors
            throw error;
          }
        } finally {
          if (inFlightProjectIdRef.current === project_id) {
            inFlightProjectIdRef.current = null;
          }
        }
      })();

      currentLoadPromiseRef.current = loadPromise;

      try {
        await loadPromise;
      } finally {
        // Clear the promise ref if this was the current load
        if (currentLoadPromiseRef.current === loadPromise) {
          currentLoadPromiseRef.current = null;
        }
      }
    };

    init();

    return () => {
      debugLog(`[Editor] Cleanup - aborting loads for project: ${project_id}`);
      abortController.abort();
      // Don't clear currentLoadPromiseRef here - let it complete naturally
    };
  }, [
    project_id,
    activeProject?.id,
    loadProject,
    createNewProject,
    isInvalidProjectId,
    markProjectIdAsInvalid,
    navigate,
  ]);

  // Get active preset and reset counter for panel layouts
  const activePreset = usePanelStore((s) => s.activePreset) ?? "default";
  const resetCounter = usePanelStore((s) => s.resetCounter) ?? 0;

  // Debug: Log which layout is being used
  if (import.meta.env.DEV) {
    console.log(`🎯 Editor using layout: ${activePreset}, resetCounter: ${resetCounter}`);
  }

  usePlaybackControls();

  const layouts = {
    media: <MediaLayout resetCounter={resetCounter} />,
    inspector: <InspectorLayout resetCounter={resetCounter} />,
    "vertical-preview": <VerticalPreviewLayout resetCounter={resetCounter} />,
    default: <DefaultLayout resetCounter={resetCounter} />,
  };

  const selectedLayout = layouts[activePreset] || layouts.default;

  return (
    <EditorProvider>
      <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        <EditorHeader />
        <div className="flex-1 min-h-0 min-w-0">{selectedLayout}</div>
        <Onboarding />
      </div>
    </EditorProvider>
  );
}
