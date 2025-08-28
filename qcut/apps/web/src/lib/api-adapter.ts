import { isFeatureEnabled } from './feature-flags';

export async function searchSounds(
  query: string, 
  options: { 
    retryCount?: number; 
    fallbackToOld?: boolean;
    type?: 'effects' | 'songs';
    page?: number;
    page_size?: number;
    sort?: 'downloads' | 'rating' | 'created' | 'score';
    min_rating?: number;
    commercial_only?: boolean;
  } = {}
) {
  const { retryCount = 3, fallbackToOld = true, ...searchParams } = options;
  
  try {
    if (isFeatureEnabled('USE_ELECTRON_API')) {
      // New Electron IPC implementation
      const result = await window.electronAPI?.sounds.search({ 
        q: query, 
        ...searchParams 
      });
      
      if (!result?.success && fallbackToOld) {
        throw new Error(result?.error || 'IPC failed');
      }
      return result;
    }
  } catch (error) {
    console.error('Electron API failed, falling back', error);
    if (fallbackToOld) {
      // Fallback to old API if new one fails
      const urlParams = new URLSearchParams();
      if (query) urlParams.set('q', query);
      if (searchParams.type) urlParams.set('type', searchParams.type);
      if (searchParams.page) urlParams.set('page', searchParams.page.toString());
      if (searchParams.page_size) urlParams.set('page_size', searchParams.page_size.toString());
      if (searchParams.sort) urlParams.set('sort', searchParams.sort);
      if (searchParams.min_rating) urlParams.set('min_rating', searchParams.min_rating.toString());
      if (searchParams.commercial_only !== undefined) urlParams.set('commercial_only', searchParams.commercial_only.toString());

      for (let i = 0; i < retryCount; i++) {
        try {
          const res = await fetch(`/api/sounds/search?${urlParams.toString()}`);
          if (res.ok) return await res.json();
        } catch (fetchError) {
          console.error(`Fetch attempt ${i + 1} failed:`, fetchError);
        }
        if (i < retryCount - 1) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1))); // exponential backoff
        }
      }
      return { success: false, error: 'Fallback failed after retries' };
    }
    throw error;
  }
  
  // Original implementation
  const urlParams = new URLSearchParams();
  if (query) urlParams.set('q', query);
  if (searchParams.type) urlParams.set('type', searchParams.type);
  if (searchParams.page) urlParams.set('page', searchParams.page.toString());
  if (searchParams.page_size) urlParams.set('page_size', searchParams.page_size.toString());
  if (searchParams.sort) urlParams.set('sort', searchParams.sort);
  if (searchParams.min_rating) urlParams.set('min_rating', searchParams.min_rating.toString());
  if (searchParams.commercial_only !== undefined) urlParams.set('commercial_only', searchParams.commercial_only.toString());

  const res = await fetch(`/api/sounds/search?${urlParams.toString()}`);
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
  return await res.json();
}