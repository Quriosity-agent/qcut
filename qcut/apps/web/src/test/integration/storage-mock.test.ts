import { describe, it, expect, vi } from 'vitest';
import { mockStorageService, MockStorageAdapter } from '@/test/mocks/storage';

describe('Storage Service Mock', () => {
  it('mocks storage operations', async () => {
    // Test project operations
    await mockStorageService.saveProject({ id: 'test', name: 'Test' } as any);
    expect(mockStorageService.saveProject).toHaveBeenCalled();
    
    const project = await mockStorageService.loadProject('test');
    expect(project).toEqual({ id: 'test-project', name: 'Test' });
    
    // Test media operations
    const mediaId = await mockStorageService.saveMediaFile('test-file' as any);
    expect(mediaId).toBe('media-id');
    
    // Test storage adapter
    const adapter = new MockStorageAdapter();
    await adapter.set('key', 'value');
    const value = await adapter.get('key');
    expect(value).toBe('value');
  });
});