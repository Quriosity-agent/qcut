/**
 * Angles Tab State Hook
 *
 * Manages state for the cinematic angles tab including
 * source image, generated angle results, and selection state.
 */

import { useState, useCallback } from "react";
import type { CinematicAngleId } from "../constants/angles-config";
import { CINEMATIC_ANGLES } from "../constants/angles-config";

export interface AngleResult {
  url: string;
  selected: boolean;
}

export interface AnglesTabState {
  sourceImage: File | null;
  sourceImagePreview: string | null;
  generatedAngles: Partial<Record<CinematicAngleId, AngleResult>>;
  isGenerating: boolean;
  generatingAngles: Set<CinematicAngleId>;
}

export function useAnglesTabState() {
  const [sourceImage, setSourceImageRaw] = useState<File | null>(null);
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(
    null
  );
  const [generatedAngles, setGeneratedAngles] = useState<
    Partial<Record<CinematicAngleId, AngleResult>>
  >({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingAngles, setGeneratingAngles] = useState<
    Set<CinematicAngleId>
  >(new Set());

  const setSourceImage = useCallback(
    (file: File | null, preview: string | null) => {
      setSourceImageRaw(file);
      setSourceImagePreview(preview);
      // Clear previous results when source image changes
      if (!file) {
        setGeneratedAngles({});
      }
    },
    []
  );

  const toggleAngleSelection = useCallback((angleId: CinematicAngleId) => {
    setGeneratedAngles((prev) => {
      const existing = prev[angleId];
      if (!existing) return prev;
      return {
        ...prev,
        [angleId]: { ...existing, selected: !existing.selected },
      };
    });
  }, []);

  const selectAllAngles = useCallback(() => {
    setGeneratedAngles((prev) => {
      const next = { ...prev };
      for (const angle of CINEMATIC_ANGLES) {
        const existing = next[angle.id];
        if (existing) {
          next[angle.id] = { ...existing, selected: true };
        }
      }
      return next;
    });
  }, []);

  const deselectAllAngles = useCallback(() => {
    setGeneratedAngles((prev) => {
      const next = { ...prev };
      for (const angle of CINEMATIC_ANGLES) {
        const existing = next[angle.id];
        if (existing) {
          next[angle.id] = { ...existing, selected: false };
        }
      }
      return next;
    });
  }, []);

  const setAngleResult = useCallback(
    (angleId: CinematicAngleId, url: string) => {
      setGeneratedAngles((prev) => ({
        ...prev,
        [angleId]: { url, selected: false },
      }));
    },
    []
  );

  const markAngleGenerating = useCallback(
    (angleId: CinematicAngleId, generating: boolean) => {
      setGeneratingAngles((prev) => {
        const next = new Set(prev);
        if (generating) {
          next.add(angleId);
        } else {
          next.delete(angleId);
        }
        return next;
      });
    },
    []
  );

  const selectedCount = Object.values(generatedAngles).filter(
    (a) => a?.selected
  ).length;

  const generatedCount = Object.keys(generatedAngles).length;

  const selectedUrls = Object.entries(generatedAngles)
    .filter(([, result]) => result?.selected)
    .map(([id, result]) => ({
      id: id as CinematicAngleId,
      url: result!.url,
    }));

  return {
    state: {
      sourceImage,
      sourceImagePreview,
      generatedAngles,
      isGenerating,
      generatingAngles,
      selectedCount,
      generatedCount,
      selectedUrls,
    },
    setters: {
      setSourceImage,
      setGeneratedAngles,
      setIsGenerating,
      setGeneratingAngles,
      setAngleResult,
      markAngleGenerating,
    },
    actions: {
      toggleAngleSelection,
      selectAllAngles,
      deselectAllAngles,
    },
  };
}
