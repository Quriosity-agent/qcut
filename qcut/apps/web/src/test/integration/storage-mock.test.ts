import { describe, it, expect, vi } from 'vitest';
import { mockStorageService } from '@/test/mocks/storage';

describe('Storage Service Mock', () => {
  it('mocks storage operations', async () => {
    const key = 'test-key';
    const value = { data: 'test-value' };
    
    // Test set operation
    await mockStorageService.set(key, value);
    expect(mockStorageService.set).toHaveBeenCalledWith(key, value);
    
    // Test get operation
    mockStorageService.get.mockResolvedValue(value);
    const result = await mockStorageService.get(key);
    expect(result).toEqual(value);
    
    // Test remove operation
    await mockStorageService.remove(key);
    expect(mockStorageService.remove).toHaveBeenCalledWith(key);
  });
});