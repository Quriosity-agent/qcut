import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPerformanceMocks, simulateMemoryPressure, getMemoryUsage } from '@/test/mocks/performance';

describe('Memory Utilities', () => {
  let cleanup: () => void;
  
  beforeEach(() => {
    cleanup = setupPerformanceMocks();
  });
  
  afterEach(() => {
    cleanup();
  });
  
  describe('formatFileSize', () => {
    // Helper function for testing
    function formatFileSize(bytes: number): string {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    it('formats bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512.0 B');
      expect(formatFileSize(1023)).toBe('1023.0 B');
    });
    
    it('formats kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10.0 KB');
      expect(formatFileSize(102400)).toBe('100.0 KB');
    });
    
    it('formats megabytes correctly', () => {
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(5242880)).toBe('5.0 MB');
      expect(formatFileSize(10485760)).toBe('10.0 MB');
      expect(formatFileSize(1572864)).toBe('1.5 MB'); // 1.5 * 1024 * 1024
    });
    
    it('formats gigabytes correctly', () => {
      expect(formatFileSize(1073741824)).toBe('1.0 GB');
      expect(formatFileSize(5368709120)).toBe('5.0 GB');
      expect(formatFileSize(1610612736)).toBe('1.5 GB');
    });
    
    it('formats terabytes correctly', () => {
      expect(formatFileSize(1099511627776)).toBe('1.0 TB');
      expect(formatFileSize(2199023255552)).toBe('2.0 TB');
    });
  });
  
  describe('Memory Monitoring', () => {
    it('checks memory usage', () => {
      const usage = getMemoryUsage();
      expect(typeof usage).toBe('number');
      expect(usage).toBeGreaterThanOrEqual(0);
      expect(usage).toBe(100000000); // Default mock value
    });
    
    it('simulates memory pressure', () => {
      simulateMemoryPressure(90); // 90% usage
      const usage = getMemoryUsage();
      expect(usage).toBe(450000000); // 90% of 500MB limit
      
      simulateMemoryPressure(50); // 50% usage
      const usage2 = getMemoryUsage();
      expect(usage2).toBe(250000000); // 50% of 500MB limit
    });
    
    it('detects high memory usage', () => {
      function checkMemoryPressure(threshold = 0.8): boolean {
        if (!performance.memory) return false;
        const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
        return usedJSHeapSize / jsHeapSizeLimit > threshold;
      }
      
      simulateMemoryPressure(90);
      expect(checkMemoryPressure()).toBe(true);
      expect(checkMemoryPressure(0.85)).toBe(true);
      
      simulateMemoryPressure(50);
      expect(checkMemoryPressure()).toBe(false);
      expect(checkMemoryPressure(0.4)).toBe(true);
    });
  });
});