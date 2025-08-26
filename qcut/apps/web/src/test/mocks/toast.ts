import { vi } from 'vitest';

/**
 * Mock for sonner toast library (used throughout the app)
 */
export const mockToast = {
  success: vi.fn((message: string, options?: any) => 'toast-id'),
  error: vi.fn((message: string, options?: any) => 'toast-id'),
  info: vi.fn((message: string, options?: any) => 'toast-id'),
  warning: vi.fn((message: string, options?: any) => 'toast-id'),
  message: vi.fn((message: string, options?: any) => 'toast-id'),
  loading: vi.fn((message: string, options?: any) => 'toast-id'),
  promise: vi.fn((promise: Promise<any>, options: any) => promise),
  custom: vi.fn((component: any, options?: any) => 'toast-id'),
  dismiss: vi.fn((id?: string) => undefined),
};

/**
 * Mock for use-toast hook
 */
export const mockUseToast = () => ({
  toast: mockToast.success,
  toasts: [],
  dismiss: mockToast.dismiss,
});

/**
 * Setup global toast mock
 */
export function setupToastMock() {
  vi.mock('sonner', () => ({
    toast: mockToast,
    Toaster: vi.fn(() => null),
  }));
  
  vi.mock('@/hooks/use-toast', () => ({
    useToast: mockUseToast,
  }));
}