import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '@/hooks/use-debounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });
  
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500));
    expect(result.current).toBe('initial');
  });
  
  it('debounces value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    );
    
    expect(result.current).toBe('initial');
    
    // Change value
    rerender({ value: 'updated', delay: 500 });
    
    // Value should not change immediately
    expect(result.current).toBe('initial');
    
    // Advance time by less than delay
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe('initial');
    
    // Advance time to complete delay
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('updated');
  });
  
  it('cancels previous timeout on rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'first', delay: 500 } }
    );
    
    // Make rapid changes
    rerender({ value: 'second', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    
    rerender({ value: 'third', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    
    rerender({ value: 'final', delay: 500 });
    
    // Only 400ms passed, should still be 'first'
    expect(result.current).toBe('first');
    
    // Advance to complete the last delay
    act(() => {
      vi.advanceTimersByTime(500);
    });
    
    // Should now be the final value
    expect(result.current).toBe('final');
  });
  
  it('handles delay changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 1000 } }
    );
    
    rerender({ value: 'updated', delay: 500 });
    
    // New delay should be respected
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('updated');
  });
  
  it('works with complex objects', () => {
    const initialObject = { count: 0, text: 'hello' };
    const updatedObject = { count: 1, text: 'world' };
    
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: initialObject, delay: 300 } }
    );
    
    expect(result.current).toEqual(initialObject);
    
    rerender({ value: updatedObject, delay: 300 });
    
    act(() => {
      vi.advanceTimersByTime(300);
    });
    
    expect(result.current).toEqual(updatedObject);
  });
  
  it('cleans up timeout on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    
    const { unmount, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'test', delay: 500 } }
    );
    
    rerender({ value: 'updated', delay: 500 });
    
    unmount();
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});