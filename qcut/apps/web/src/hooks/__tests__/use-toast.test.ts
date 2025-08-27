import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Clear any mocks before importing the real module
vi.unmock('@/hooks/use-toast');

// Import the real implementation
import { useToast, toast, reducer } from '@/hooks/use-toast';

describe('useToast', () => {
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
  
  describe('toast function', () => {
    it('creates a toast with title and description', () => {
      const { result } = renderHook(() => useToast());
      
      act(() => {
        toast({
          title: 'Success',
          description: 'Operation completed',
        });
      });
      
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]).toMatchObject({
        title: 'Success',
        description: 'Operation completed',
        open: true,
      });
    });
    
    it('returns toast controls', () => {
      const toastResult = toast({
        title: 'Test Toast',
      });
      
      expect(toastResult).toHaveProperty('id');
      expect(toastResult).toHaveProperty('dismiss');
      expect(toastResult).toHaveProperty('update');
      expect(typeof toastResult.id).toBe('string');
      expect(typeof toastResult.dismiss).toBe('function');
      expect(typeof toastResult.update).toBe('function');
    });
    
    it('limits toasts to TOAST_LIMIT (1)', () => {
      const { result } = renderHook(() => useToast());
      
      act(() => {
        toast({ title: 'Toast 1' });
        toast({ title: 'Toast 2' });
        toast({ title: 'Toast 3' });
      });
      
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.title).toBe('Toast 3'); // Most recent
    });
  });
  
  describe('useToast hook', () => {
    it('provides toast state and methods', () => {
      const { result } = renderHook(() => useToast());
      
      expect(result.current.toasts).toBeDefined();
      expect(typeof result.current.toast).toBe('function');
      expect(typeof result.current.dismiss).toBe('function');
    });
    
    it('updates when toast is added', () => {
      const { result } = renderHook(() => useToast());
      
      act(() => {
        result.current.toast({
          title: 'New Toast',
          variant: 'default',
        });
      });
      
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.title).toBe('New Toast');
      expect(result.current.toasts[0]?.variant).toBe('default');
    });
    
    it('dismisses specific toast', () => {
      const { result } = renderHook(() => useToast());
      let toastId: string = '';
      
      act(() => {
        const toastResult = result.current.toast({
          title: 'Dismissible Toast',
        });
        toastId = toastResult.id;
      });
      
      expect(result.current.toasts).toHaveLength(1);
      
      act(() => {
        result.current.dismiss(toastId);
      });
      
      // Toast should be marked as closed
      expect(result.current.toasts[0]?.open).toBe(false);
      
      // After TOAST_REMOVE_DELAY, toast should be removed
      act(() => {
        vi.advanceTimersByTime(1_000_000);
      });
      
      expect(result.current.toasts).toHaveLength(0);
    });
    
    it('dismisses all toasts when no id provided', () => {
      const { result } = renderHook(() => useToast());
      
      act(() => {
        result.current.toast({ title: 'Toast 1' });
      });
      
      expect(result.current.toasts).toHaveLength(1);
      
      act(() => {
        result.current.dismiss();
      });
      
      // All toasts should be marked as closed
      expect(result.current.toasts.every(t => !t.open)).toBe(true);
    });
  });
  
  describe('toast update', () => {
    it('updates existing toast', () => {
      const { result } = renderHook(() => useToast());
      let toastResult: any;
      
      act(() => {
        toastResult = result.current.toast({
          title: 'Initial Title',
        });
      });
      
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.title).toBe('Initial Title');
      
      act(() => {
        toastResult.update({
          id: toastResult.id,
          title: 'Updated Title',
          description: 'New Description',
        });
      });
      
      expect(result.current.toasts[0]?.title).toBe('Updated Title');
      expect(result.current.toasts[0]?.description).toBe('New Description');
    });
  });
  
  describe('reducer', () => {
    const initialState = { toasts: [] };
    
    it('handles ADD_TOAST action', () => {
      const toast = {
        id: '1',
        title: 'Test',
        open: true,
      };
      
      const newState = reducer(initialState, {
        type: 'ADD_TOAST',
        toast,
      });
      
      expect(newState.toasts).toHaveLength(1);
      expect(newState.toasts[0]).toEqual(toast);
    });
    
    it('handles UPDATE_TOAST action', () => {
      const state = {
        toasts: [{
          id: '1',
          title: 'Original',
          open: true,
        }],
      };
      
      const newState = reducer(state, {
        type: 'UPDATE_TOAST',
        toast: {
          id: '1',
          title: 'Updated',
        },
      });
      
      expect(newState.toasts[0].title).toBe('Updated');
    });
    
    it('handles REMOVE_TOAST action', () => {
      const state = {
        toasts: [{
          id: '1',
          title: 'Toast 1',
          open: true,
        }, {
          id: '2',
          title: 'Toast 2',
          open: true,
        }],
      };
      
      const newState = reducer(state, {
        type: 'REMOVE_TOAST',
        toastId: '1',
      });
      
      expect(newState.toasts).toHaveLength(1);
      expect(newState.toasts[0].id).toBe('2');
    });
    
    it('handles DISMISS_TOAST action', () => {
      const state = {
        toasts: [{
          id: '1',
          title: 'Toast',
          open: true,
        }],
      };
      
      const newState = reducer(state, {
        type: 'DISMISS_TOAST',
        toastId: '1',
      });
      
      expect(newState.toasts[0].open).toBe(false);
    });
  });
  
  describe('multiple hooks', () => {
    it('syncs state between multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useToast());
      const { result: result2 } = renderHook(() => useToast());
      
      // Initially both should have same state
      expect(result1.current.toasts).toEqual(result2.current.toasts);
      
      // Add a toast from first hook
      act(() => {
        result1.current.toast({
          title: 'Shared Toast',
        });
      });
      
      // Both hooks should see the new toast
      expect(result1.current.toasts).toHaveLength(1);
      expect(result2.current.toasts).toHaveLength(1);
      expect(result1.current.toasts[0]?.title).toBe('Shared Toast');
      expect(result2.current.toasts[0]?.title).toBe('Shared Toast');
    });
  });
});