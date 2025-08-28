import { isFeatureEnabled } from "./feature-flags";

// Helper function for legacy sound search with retry logic
async function legacySoundSearch(
  query: string,
  searchParams: {
    type?: "effects" | "songs";
    page?: number;
    page_size?: number;
    sort?: "downloads" | "rating" | "created" | "score";
    min_rating?: number;
    commercial_only?: boolean;
  },
  retryCount: number
) {
  const urlParams = new URLSearchParams();
  if (query) urlParams.set("q", query);
  if (searchParams.type) urlParams.set("type", searchParams.type);
  if (searchParams.page != null)
    urlParams.set("page", String(searchParams.page));
  if (searchParams.page_size != null)
    urlParams.set("page_size", String(searchParams.page_size));
  if (searchParams.sort) urlParams.set("sort", searchParams.sort);
  if (searchParams.min_rating != null)
    urlParams.set("min_rating", String(searchParams.min_rating));
  if (searchParams.commercial_only !== undefined)
    urlParams.set("commercial_only", String(searchParams.commercial_only));

  for (let i = 0; i < retryCount; i++) {
    try {
      const res = await fetch(`/api/sounds/search?${urlParams.toString()}`);
      if (res.ok) return await res.json();
    } catch (fetchError) {
      console.error(`Fetch attempt ${i + 1} failed:`, fetchError);
    }
    if (i < retryCount - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // exponential backoff
    }
  }
  return { success: false, error: "API call failed after retries" };
}

// Helper function for legacy transcribe with retry logic
async function legacyTranscribe(
  requestData: {
    filename: string;
    language?: string;
    decryptionKey?: string;
    iv?: string;
  },
  retryCount: number
) {
  for (let i = 0; i < retryCount; i++) {
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });
      if (res.ok) return await res.json();
    } catch (fetchError) {
      console.error(`Transcription fetch attempt ${i + 1} failed:`, fetchError);
    }
    if (i < retryCount - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // exponential backoff
    }
  }
  return { success: false, error: "API call failed after retries" };
}

export async function searchSounds(
  query: string,
  options: {
    retryCount?: number;
    fallbackToOld?: boolean;
    type?: "effects" | "songs";
    page?: number;
    page_size?: number;
    sort?: "downloads" | "rating" | "created" | "score";
    min_rating?: number;
    commercial_only?: boolean;
  } = {}
) {
  const { retryCount = 3, fallbackToOld = true, ...searchParams } = options;

  if (isFeatureEnabled("USE_ELECTRON_API")) {
    try {
      // New Electron IPC implementation
      const result = await window.electronAPI?.sounds.search({
        q: query,
        ...searchParams,
      });

      if (result?.success) {
        return result;
      }
      if (!fallbackToOld) {
        return result;
      }
      throw new Error(result?.error || "IPC failed, attempting fallback");
    } catch (error) {
      console.error("Electron API failed, falling back:", error);
      if (fallbackToOld && !isFeatureEnabled("USE_ELECTRON_API")) {
        return legacySoundSearch(query, searchParams, retryCount);
      }
      throw error;
    }
  }

  // Original path now also has consistent retry logic
  return legacySoundSearch(query, searchParams, retryCount);
}

export async function transcribeAudio(
  requestData: {
    filename: string;
    language?: string;
    decryptionKey?: string;
    iv?: string;
  },
  options: {
    retryCount?: number;
    fallbackToOld?: boolean;
  } = {}
) {
  const { retryCount = 3, fallbackToOld = true } = options;

  if (isFeatureEnabled("USE_ELECTRON_API")) {
    try {
      // New Electron IPC implementation - add missing id parameter
      const requestWithId = { ...requestData, id: crypto.randomUUID() };
      const result = await window.electronAPI?.transcribe.audio(requestWithId);

      if (result?.success) {
        return result;
      }
      if (!fallbackToOld) {
        return result;
      }
      throw new Error(result?.error || "IPC transcription failed, attempting fallback");
    } catch {
      if (fallbackToOld) {
        return legacyTranscribe(requestData, retryCount);
      }
      throw new Error("IPC transcription failed and fallback disabled");
    }
  }

  // Original path now also has consistent retry logic
  return legacyTranscribe(requestData, retryCount);
}
