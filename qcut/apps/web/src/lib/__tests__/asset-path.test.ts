import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAssetPath } from '@/lib/asset-path';

describe('Asset Path Utilities', () => {
  describe('getAssetPath', () => {
    const originalLocation = window.location;
    
    beforeEach(() => {
      // Mock window.location
      delete (window as any).location;
    });
    
    afterEach(() => {
      (window as any).location = originalLocation;
      vi.unstubAllGlobals();
    });
    
    it('returns absolute path for web environment', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
      };
      
      expect(getAssetPath('assets/image.png')).toBe('/assets/image.png');
      expect(getAssetPath('/assets/image.png')).toBe('/assets/image.png');
    });
    
    it('returns absolute path for https environment', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'https:',
      };
      
      expect(getAssetPath('assets/video.mp4')).toBe('/assets/video.mp4');
      expect(getAssetPath('/assets/video.mp4')).toBe('/assets/video.mp4');
    });
    
    it('returns relative path for Electron environment', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('assets/image.png')).toBe('./assets/image.png');
      expect(getAssetPath('/assets/image.png')).toBe('./assets/image.png');
    });
    
    it('handles paths without leading slash in Electron', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('fonts/roboto.ttf')).toBe('./fonts/roboto.ttf');
      expect(getAssetPath('images/logo.svg')).toBe('./images/logo.svg');
    });
    
    it('handles paths with leading slash in Electron', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('/fonts/roboto.ttf')).toBe('./fonts/roboto.ttf');
      expect(getAssetPath('/images/logo.svg')).toBe('./images/logo.svg');
    });
    
    it('handles empty path', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
      };
      
      expect(getAssetPath('')).toBe('/');
      
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('')).toBe('./');
    });
    
    it('handles paths with subdirectories', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
      };
      
      expect(getAssetPath('assets/images/thumbnails/video1.jpg')).toBe('/assets/images/thumbnails/video1.jpg');
      
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('assets/images/thumbnails/video1.jpg')).toBe('./assets/images/thumbnails/video1.jpg');
    });
    
    it('handles paths with query parameters', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
      };
      
      expect(getAssetPath('assets/font.woff2?v=1.2.3')).toBe('/assets/font.woff2?v=1.2.3');
      
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('assets/font.woff2?v=1.2.3')).toBe('./assets/font.woff2?v=1.2.3');
    });
    
    it('handles paths with hashes', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
      };
      
      expect(getAssetPath('assets/icons.svg#icon-play')).toBe('/assets/icons.svg#icon-play');
      
      (window as any).location = {
        ...originalLocation,
        protocol: 'file:',
      };
      
      expect(getAssetPath('assets/icons.svg#icon-play')).toBe('./assets/icons.svg#icon-play');
    });
    
    it('handles localhost development environment', () => {
      (window as any).location = {
        ...originalLocation,
        protocol: 'http:',
        hostname: 'localhost',
      };
      
      expect(getAssetPath('assets/dev-asset.js')).toBe('/assets/dev-asset.js');
    });
    
    it('handles undefined window gracefully', () => {
      // Use vi.stubGlobal for safe cleanup even if test fails
      vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis);
      
      // Should default to web behavior when window is undefined
      expect(getAssetPath('assets/test.png')).toBe('/assets/test.png');
      
      // Cleanup is handled by afterEach calling vi.unstubAllGlobals()
    });
  });
});