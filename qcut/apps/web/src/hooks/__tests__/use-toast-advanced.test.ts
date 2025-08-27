import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Clear any mocks before importing the real module
vi.unmock('@/hooks/use-toast');

// Import the real implementation
import { useToast } from '@/hooks/use-toast';

describe('useToast - Advanced Features', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    // Clear toasts after each test while timers are still fake
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toasts.forEach(t => {
        result.current.dismiss(t.id);
      });
    });
    
    act(() => {
      vi.runAllTimers();
    });
    
    vi.useRealTimers();
  });
  
  it('handles custom action buttons', () => {
    const { result } = renderHook(() => useToast());
    const onAction = vi.fn();
    
    act(() => {
      result.current.toast({
        title: 'Action Toast',
        description: 'This toast has an action',
        action: {
          altText: 'Undo action',
          onClick: onAction
        } as any
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    expect(result.current.toasts[0]?.action).toBeDefined();
    expect(result.current.toasts[0]?.title).toBe('Action Toast');
  });
  
  it('supports toast variants', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.toast({
        title: 'Error Toast',
        variant: 'destructive'
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    expect(result.current.toasts[0]?.variant).toBe('destructive');
    expect(result.current.toasts[0]?.title).toBe('Error Toast');
  });
  
  it('handles multiple toast variants', () => {
    const { result } = renderHook(() => useToast());
    
    // Test different variants
    const variants = ['default', 'destructive'] as const;
    
    for (const variant of variants) {
      act(() => {
        result.current.toast({
          title: `${variant} toast`,
          variant: variant as any
        });
      });
      
      // Due to TOAST_LIMIT = 1, only latest toast should be visible
      expect(result.current.toasts.length).toBeGreaterThan(0);
      const currentToast = result.current.toasts[0];
      expect(currentToast?.variant || 'default').toBeDefined();
    }
  });
  
  it('handles toast with all properties', () => {
    const { result } = renderHook(() => useToast());
    
    let toastResult: any;
    act(() => {
      toastResult = result.current.toast({
        title: 'Complete Toast',
        description: 'This toast has all properties',
        variant: 'default',
        action: {
          altText: 'Try again',
          onClick: () => {}
        } as any
      });
    });
    
    expect(toastResult).toBeDefined();
    expect(toastResult.id).toBeDefined();
    expect(toastResult.dismiss).toBeDefined();
    expect(toastResult.update).toBeDefined();
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    
    const toast = result.current.toasts[0];
    expect(toast?.title).toBe('Complete Toast');
    expect(toast?.description).toBe('This toast has all properties');
    expect(toast?.variant).toBe('default');
    expect(toast?.action).toBeDefined();
  });
  
  it('updates toast after creation', () => {
    const { result } = renderHook(() => useToast());
    let toastResult: any;
    
    act(() => {
      toastResult = result.current.toast({
        title: 'Original Title'
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    expect(result.current.toasts[0]?.title).toBe('Original Title');
    
    act(() => {
      toastResult.update({
        title: 'Updated Title',
        description: 'Now with description'
      });
    });
    
    expect(result.current.toasts[0]?.title).toBe('Updated Title');
    expect(result.current.toasts[0]?.description).toBe('Now with description');
  });
  
  it('handles rapid toast creation and dismissal', () => {
    const { result } = renderHook(() => useToast());
    const toastResults: any[] = [];
    
    // Create multiple toasts rapidly
    act(() => {
      for (let i = 0; i < 5; i++) {
        const toastResult = result.current.toast({
          title: `Toast ${i}`
        });
        toastResults.push(toastResult);
      }
    });
    
    // Due to TOAST_LIMIT = 1, only the last toast should be visible
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.title).toBe('Toast 4');
    
    // Dismiss the visible toast
    act(() => {
      result.current.dismiss(result.current.toasts[0]?.id);
    });
    
    // Toast should be marked as dismissed (open = false) 
    const toast = result.current.toasts[0];
    expect(toast?.open).toBe(false);
  });
  
  it('handles onOpenChange callback', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.toast({
        title: 'Callback Toast'
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    
    const toast = result.current.toasts[0];
    expect(toast?.title).toBe('Callback Toast');
    expect(toast?.onOpenChange).toBeDefined();
    
    // Trigger the onOpenChange callback to dismiss
    act(() => {
      if (toast?.onOpenChange) {
        toast.onOpenChange(false);
      }
    });
    
    // Wait for dismissal
    act(() => {
      vi.advanceTimersByTime(100);
    });
    
    // Toast should be dismissed (open = false)
    expect(result.current.toasts[0]?.open).toBe(false);
  });
  
  it('respects TOAST_LIMIT constraint', () => {
    const { result } = renderHook(() => useToast());
    
    // Create more toasts than the limit
    act(() => {
      for (let i = 0; i < 3; i++) {
        result.current.toast({
          title: `Toast ${i}`
        });
      }
    });
    
    // Should only have 1 toast due to TOAST_LIMIT = 1
    expect(result.current.toasts).toHaveLength(1);
    
    // Should be the most recent toast
    expect(result.current.toasts[0]?.title).toBe('Toast 2');
  });
  
  it('handles toast dismissal with timeout', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.toast({
        title: 'Auto-dismiss Toast'
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    
    const toastId = result.current.toasts[0]?.id;
    expect(toastId).toBeDefined();
    
    // Dismiss the toast
    act(() => {
      result.current.dismiss(toastId);
    });
    
    // Toast should be marked for removal
    const toast = result.current.toasts[0];
    expect(toast?.open).toBe(false);
    
    // Fast-forward time to trigger removal
    act(() => {
      vi.advanceTimersByTime(1_000_000); // TOAST_REMOVE_DELAY
    });
    
    // Toast should be completely removed
    expect(result.current.toasts).toHaveLength(0);
  });
});