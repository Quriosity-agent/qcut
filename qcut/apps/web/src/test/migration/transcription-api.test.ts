import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio } from '@/lib/api-adapter';
import { setRuntimeFlags, isFeatureEnabled } from '@/lib/feature-flags';

// Mock the global fetch function
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.electronAPI
const mockElectronAPI = {
  transcribe: {
    audio: vi.fn()
  }
};

// Mock window object
Object.defineProperty(global, 'window', {
  value: {
    electronAPI: mockElectronAPI
  },
  writable: true
});

describe('Transcription API Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset runtime flags
    setRuntimeFlags({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Feature Flag Testing', () => {
    it('should use Electron API when USE_ELECTRON_API is true', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const mockResult = {
        success: true,
        text: 'Hello world, this is a test transcription.',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 2.5,
            text: 'Hello world, this is a test transcription.'
          }
        ],
        language: 'en'
      };

      mockElectronAPI.transcribe.audio.mockResolvedValue(mockResult);

      const result = await transcribeAudio({
        filename: 'test-audio.wav',
        language: 'en'
      });

      expect(mockElectronAPI.transcribe.audio).toHaveBeenCalledWith({
        filename: 'test-audio.wav',
        language: 'en'
      });
      expect(result).toEqual(mockResult);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle zero-knowledge encryption parameters', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const mockResult = {
        success: true,
        text: 'Encrypted transcription test',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 3.0,
            text: 'Encrypted transcription test'
          }
        ],
        language: 'auto'
      };

      mockElectronAPI.transcribe.audio.mockResolvedValue(mockResult);

      const requestData = {
        filename: 'encrypted-audio.wav',
        language: 'auto',
        decryptionKey: 'base64encodedkey',
        iv: 'base64encodediv'
      };

      const result = await transcribeAudio(requestData);

      expect(mockElectronAPI.transcribe.audio).toHaveBeenCalledWith(requestData);
      expect(result).toEqual(mockResult);
    });

    it('should fall back to Next.js API when Electron API fails', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      // Mock Electron API failure
      mockElectronAPI.transcribe.audio.mockRejectedValue(new Error('IPC failed'));
      
      // Mock successful Next.js API response
      const mockApiResponse = {
        success: true,
        text: 'Fallback transcription result',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 4.2,
            text: 'Fallback transcription result'
          }
        ],
        language: 'en'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse)
      });

      const result = await transcribeAudio({
        filename: 'fallback-test.wav',
        language: 'en'
      }, { fallbackToOld: true });

      expect(mockElectronAPI.transcribe.audio).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: 'fallback-test.wav',
          language: 'en'
        }),
      });
      expect(result).toEqual(mockApiResponse);
    });

    it('should use Next.js API when USE_ELECTRON_API is false', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: false });
      
      const mockApiResponse = {
        success: true,
        text: 'Direct Next.js API transcription',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 5.1,
            text: 'Direct Next.js API transcription'
          }
        ],
        language: 'es'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse)
      });

      const result = await transcribeAudio({
        filename: 'nextjs-test.wav',
        language: 'es',
        decryptionKey: 'testkey',
        iv: 'testiv'
      });

      expect(mockElectronAPI.transcribe.audio).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: 'nextjs-test.wav',
          language: 'es',
          decryptionKey: 'testkey',
          iv: 'testiv'
        }),
      });
      expect(result).toEqual(mockApiResponse);
    });
  });

  describe('Error Handling', () => {
    it('should handle Electron API errors gracefully', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const errorResult = {
        success: false,
        error: 'Transcription not configured',
        message: 'Auto-captions require environment variables: MODAL_TRANSCRIPTION_URL. Check README for setup instructions.'
      };
      
      mockElectronAPI.transcribe.audio.mockResolvedValue(errorResult);

      const result = await transcribeAudio({
        filename: 'error-test.wav',
        language: 'auto'
      }, { fallbackToOld: false });

      expect(result).toEqual(errorResult);
    });

    it('should handle Modal API service errors', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const serviceErrorResult = {
        success: false,
        error: 'Transcription service unavailable',
        message: 'Failed to process transcription request'
      };
      
      mockElectronAPI.transcribe.audio.mockResolvedValue(serviceErrorResult);

      const result = await transcribeAudio({
        filename: 'service-error.wav',
        language: 'fr'
      }, { fallbackToOld: false });

      expect(result).toEqual(serviceErrorResult);
    });

    it('should handle fetch errors with retries', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: false });
      
      // Mock fetch to fail twice then succeed
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            text: 'Retry successful',
            segments: [],
            language: 'auto'
          })
        });

      const result = await transcribeAudio({
        filename: 'retry-test.wav'
      }, { 
        retryCount: 3 
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.text).toBe('Retry successful');
    });
  });

  describe('Response Format Compatibility', () => {
    it('should return consistent response format from both implementations', async () => {
      const expectedResponse = {
        success: true,
        text: 'This is a consistent transcription response.',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 3.5,
            text: 'This is a consistent transcription response.'
          }
        ],
        language: 'en'
      };

      // Test Electron API
      setRuntimeFlags({ USE_ELECTRON_API: true });
      mockElectronAPI.transcribe.audio.mockResolvedValue(expectedResponse);
      
      const electronResponse = await transcribeAudio({
        filename: 'consistency-test.wav',
        language: 'en'
      });
      
      // Test Next.js API  
      setRuntimeFlags({ USE_ELECTRON_API: false });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(expectedResponse)
      });
      
      const nextjsResponse = await transcribeAudio({
        filename: 'consistency-test.wav',
        language: 'en'
      });

      // Both should have the same structure
      expect(electronResponse).toEqual(expectedResponse);
      expect(nextjsResponse).toEqual(expectedResponse);
      expect(electronResponse.success).toBe(nextjsResponse.success);
      expect(electronResponse.text).toBe(nextjsResponse.text);
      expect(electronResponse.segments).toEqual(nextjsResponse.segments);
      expect(electronResponse.language).toBe(nextjsResponse.language);
    });

    it('should handle environment configuration validation', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const configErrorResult = {
        success: false,
        error: 'Transcription not configured',
        message: 'Auto-captions require environment variables: MODAL_TRANSCRIPTION_URL. Check README for setup instructions.'
      };
      
      mockElectronAPI.transcribe.audio.mockResolvedValue(configErrorResult);

      const result = await transcribeAudio({
        filename: 'config-test.wav'
      }, { fallbackToOld: false });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transcription not configured');
      expect(result.message).toContain('MODAL_TRANSCRIPTION_URL');
    });

    it('should validate segments structure correctly', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const mockResult = {
        success: true,
        text: 'Complex multi-segment transcription.',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 1.5,
            text: 'Complex multi-segment'
          },
          {
            id: 2,
            start: 1.5,
            end: 3.0,
            text: 'transcription.'
          }
        ],
        language: 'en'
      };

      mockElectronAPI.transcribe.audio.mockResolvedValue(mockResult);

      const result = await transcribeAudio({
        filename: 'multi-segment.wav',
        language: 'en'
      });

      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toHaveProperty('id');
      expect(result.segments[0]).toHaveProperty('start');
      expect(result.segments[0]).toHaveProperty('end');
      expect(result.segments[0]).toHaveProperty('text');
      expect(typeof result.segments[0].id).toBe('number');
      expect(typeof result.segments[0].start).toBe('number');
      expect(typeof result.segments[0].end).toBe('number');
      expect(typeof result.segments[0].text).toBe('string');
    });
  });

  describe('Language Support', () => {
    it('should handle auto-detection', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const autoDetectResult = {
        success: true,
        text: 'Auto-detected language transcription',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 2.8,
            text: 'Auto-detected language transcription'
          }
        ],
        language: 'en'  // Auto-detected as English
      };

      mockElectronAPI.transcribe.audio.mockResolvedValue(autoDetectResult);

      const result = await transcribeAudio({
        filename: 'auto-detect.wav',
        language: 'auto'
      });

      expect(result.language).toBe('en');
      expect(mockElectronAPI.transcribe.audio).toHaveBeenCalledWith({
        filename: 'auto-detect.wav',
        language: 'auto'
      });
    });

    it('should handle specific language requests', async () => {
      setRuntimeFlags({ USE_ELECTRON_API: true });
      
      const specificLanguageResult = {
        success: true,
        text: 'Specific language transcription',
        segments: [
          {
            id: 1,
            start: 0.0,
            end: 2.1,
            text: 'Specific language transcription'
          }
        ],
        language: 'fr'
      };

      mockElectronAPI.transcribe.audio.mockResolvedValue(specificLanguageResult);

      const result = await transcribeAudio({
        filename: 'french-test.wav',
        language: 'fr'
      });

      expect(result.language).toBe('fr');
    });
  });
});