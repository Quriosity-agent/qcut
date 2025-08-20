/**
 * Get the correct asset path for both web and Electron environments
 * In Electron production builds, assets need to be referenced relative to the app location
 */
export function getAssetPath(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // In Electron environment, use relative path
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return `./${cleanPath}`;
  }
  
  // In web environment, use absolute path
  return `/${cleanPath}`;
}