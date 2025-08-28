import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '@/hooks/use-mobile';

describe('useIsMobile', () => {
  const originalInnerWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;
  let mockListeners: Array<(ev: { matches: boolean; media: string }) => void> = [];
  
  beforeEach(() => {
    mockListeners = [];
    window.matchMedia = vi.fn((query) => ({
      matches: window.innerWidth < 768,
      media: query,
      addEventListener: vi.fn((event, listener) => {
        if (event === 'change') {
          mockListeners.push(listener as (ev: { matches: boolean; media: string }) => void);
        }
      }),
      removeEventListener: vi.fn((event, listener) => {
        if (event === 'change') {
          const index = mockListeners.indexOf(listener as (ev: { matches: boolean; media: string }) => void);
          if (index > -1) {
            mockListeners.splice(index, 1);
          }
        }
      }),
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as MediaQueryList));
  });
  
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth
    });
    window.matchMedia = originalMatchMedia;
    mockListeners = [];
  });
  
  it('detects mobile screen size (< 768px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500
    });
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
  
  it('detects desktop screen size (>= 768px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
  
  it('detects tablet size at boundary (767px is mobile)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 767
    });
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
  
  it('detects tablet size at boundary (768px is not mobile)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768
    });
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
  
  it('responds to window resize events', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    
    // Simulate window resize to mobile size
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500
      });
      
      // Trigger change event on all listeners
      mockListeners.forEach(listener => {
        listener({ matches: true, media: '(max-width: 767px)' });
      });
    });
    
    expect(result.current).toBe(true);
  });
  
  it('cleans up event listeners on unmount', () => {
    const removeEventListenerSpy = vi.fn();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerSpy,
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as MediaQueryList));
    
    const { unmount } = renderHook(() => useIsMobile());
    
    unmount();
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });
  
  it('initializes as false when undefined', () => {
    // Hook starts with undefined and then updates
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 800
    });
    
    const { result } = renderHook(() => useIsMobile());
    
    // After effect runs, should be false for desktop size
    expect(result.current).toBe(false);
  });
});