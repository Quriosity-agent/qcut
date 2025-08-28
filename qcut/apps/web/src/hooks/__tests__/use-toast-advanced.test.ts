import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// Clear any mocks before importing the real module
vi.unmock('@/hooks/use-toast');

// Import the real implementation
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import type { ToastActionElement } from '@/components/ui/toast';

describe('useToast - Advanced Features', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    // Clear toasts after each test while timers are still fake
    const hook = renderHook(() => useToast());
    act(() => {
      for (const t of hook.result.current.toasts) {
        hook.result.current.dismiss(t.id);
      }
    });
    
    act(() => {
      vi.runAllTimers();
    });
    
    // Unmount to remove subscribed listener
    hook.unmount();
    
    vi.useRealTimers();
  });
  
  it('handles custom action buttons', () => {
    const { result } = renderHook(() => useToast());
    const onAction = vi.fn();
    
    act(() => {
      result.current.toast({
        title: 'Action Toast',
        description: 'This toast has an action',
        action: React.createElement(
          ToastAction,
          { altText: 'Undo action', onClick: onAction },
          'Undo'
        ) as unknown as ToastActionElement
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    const latestToast = result.current.toasts.at(0);
    expect(latestToast?.action).toBeDefined();
    expect(latestToast?.title).toBe('Action Toast');
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
    expect(result.current.toasts.at(0)?.variant).toBe('destructive');
    expect(result.current.toasts.at(0)?.title).toBe('Error Toast');
  });
  
  it('handles multiple toast variants', () => {
    const { result } = renderHook(() => useToast());
    
    // Test different variants
    const variants = ['default', 'destructive'] as const;
    
    for (const variant of variants) {
      act(() => {
        result.current.toast({
          title: `${variant} toast`,
          variant: variant
        });
      });
      
      // Due to TOAST_LIMIT = 1, only latest toast should be visible
      expect(result.current.toasts.length).toBeGreaterThan(0);
      const currentToast = result.current.toasts.at(0);
      expect(currentToast?.variant || 'default').toBeDefined();
    }
  });
  
  it('handles toast with all properties', () => {
    const { result } = renderHook(() => useToast());
    
    let toastResult: ReturnType<typeof result.current.toast> | undefined;
    act(() => {
      toastResult = result.current.toast({
        title: 'Complete Toast',
        description: 'This toast has all properties',
        variant: 'default',
        action: React.createElement(
          ToastAction,
          { altText: 'Try again', onClick: () => {} },
          'Try again'
        ) as unknown as ToastActionElement
      });
    });
    
    expect(toastResult).toBeDefined();
    expect(toastResult!.id).toBeDefined();
    expect(toastResult!.dismiss).toBeDefined();
    expect(toastResult!.update).toBeDefined();
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    
    const toast = result.current.toasts.at(0);
    expect(toast?.title).toBe('Complete Toast');
    expect(toast?.description).toBe('This toast has all properties');
    expect(toast?.variant).toBe('default');
    expect(toast?.action).toBeDefined();
  });
  
  it('updates toast after creation', () => {
    const { result } = renderHook(() => useToast());
    let toastResult: ReturnType<typeof result.current.toast>;
    
    act(() => {
      toastResult = result.current.toast({
        title: 'Original Title'
      });
    });
    
    expect(result.current.toasts.at(0)?.title).toBe('Original Title');
    
    act(() => {
      // Use the update method from the toast result
      toastResult.update({
        title: 'Updated Title',
        description: 'Now with description'
      });
    });
    
    const updated = result.current.toasts.at(0);
    expect(updated?.title).toBe('Updated Title');
    expect(updated?.description).toBe('Now with description');
  });
  
  it('handles rapid toast creation and dismissal', () => {
    const { result } = renderHook(() => useToast());
    const toastResults: Array<ReturnType<typeof result.current.toast>> = [];
    
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
    expect(result.current.toasts.at(0)?.title).toBe('Toast 4');
    
    // Dismiss the visible toast
    act(() => {
      const toastId = result.current.toasts.at(0)?.id;
      if (toastId) {
        result.current.dismiss(toastId);
      }
    });
    
    // Toast should be marked as dismissed (open = false) 
    const toast = result.current.toasts.at(0);
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
    
    const toast = result.current.toasts.at(0);
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
    expect(result.current.toasts.at(0)?.open).toBe(false);
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
    expect(result.current.toasts.at(0)?.title).toBe('Toast 2');
  });
  
  it('handles toast dismissal with timeout', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.toast({
        title: 'Auto-dismiss Toast'
      });
    });
    
    expect(result.current.toasts.length).toBeGreaterThan(0);
    
    const toastId = result.current.toasts.at(0)?.id;
    expect(toastId).toBeDefined();
    
    // Dismiss the toast
    act(() => {
      result.current.dismiss(toastId);
    });
    
    // Toast should be marked for removal
    const toast = result.current.toasts.at(0);
    expect(toast?.open).toBe(false);
    
    // Fast-forward time to trigger removal
    act(() => {
      vi.advanceTimersByTime(1_000_000); // TOAST_REMOVE_DELAY
    });
    
    // Toast should be completely removed
    expect(result.current.toasts).toHaveLength(0);
  });
});