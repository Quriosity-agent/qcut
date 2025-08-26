import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  isAppleDevice, 
  getPlatformSpecialKey,
  getPlatformAlternateKey,
  isDOMElement 
} from '@/lib/utils';

describe('Platform and DOM Utilities', () => {
  describe('Platform Detection', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    
    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });
    
    it('detects Apple devices', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true
      });
      expect(isAppleDevice()).toBe(true);
      expect(getPlatformSpecialKey()).toBe('⌘');
      expect(getPlatformAlternateKey()).toBe('⌥');
    });
    
    it('detects iPhone', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'iPhone',
        configurable: true
      });
      expect(isAppleDevice()).toBe(true);
    });
    
    it('detects iPad', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'iPad',
        configurable: true
      });
      expect(isAppleDevice()).toBe(true);
    });
    
    it('detects non-Apple devices', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true
      });
      expect(isAppleDevice()).toBe(false);
      expect(getPlatformSpecialKey()).toBe('Ctrl');
      expect(getPlatformAlternateKey()).toBe('Alt');
    });
    
    it('detects Linux', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux x86_64',
        configurable: true
      });
      expect(isAppleDevice()).toBe(false);
      expect(getPlatformSpecialKey()).toBe('Ctrl');
      expect(getPlatformAlternateKey()).toBe('Alt');
    });
  });
  
  describe('isDOMElement', () => {
    it('identifies DOM elements', () => {
      const div = document.createElement('div');
      expect(isDOMElement(div)).toBe(true);
      
      const span = document.createElement('span');
      expect(isDOMElement(span)).toBe(true);
      
      const input = document.createElement('input');
      expect(isDOMElement(input)).toBe(true);
    });
    
    it('identifies non-DOM elements', () => {
      expect(isDOMElement(null)).toBe(false);
      expect(isDOMElement(undefined)).toBe(false);
      expect(isDOMElement({})).toBe(false);
      expect(isDOMElement('string')).toBe(false);
      expect(isDOMElement(123)).toBe(false);
      expect(isDOMElement([])).toBe(false);
    });
  });
});