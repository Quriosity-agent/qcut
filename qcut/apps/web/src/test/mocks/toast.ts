import { vi } from "vitest";

/**
 * Mock for sonner toast library (used throughout the app)
 */
export const mockToast = {
  success: vi.fn((message: string, options?: any) => "toast-id"),
  error: vi.fn((message: string, options?: any) => "toast-id"),
  info: vi.fn((message: string, options?: any) => "toast-id"),
  warning: vi.fn((message: string, options?: any) => "toast-id"),
  message: vi.fn((message: string, options?: any) => "toast-id"),
  loading: vi.fn((message: string, options?: any) => "toast-id"),
  promise: vi.fn((promise: Promise<any>, options: any) => promise),
  custom: vi.fn((component: any, options?: any) => "toast-id"),
  dismiss: vi.fn((id?: string) => {}),
};

/**
 * Mock for use-toast hook - only used when explicitly mocked in tests
 */
export const mockUseToast = () => ({
  toast: vi.fn((props: any) => ({
    id: "toast-id",
    dismiss: vi.fn(),
    update: vi.fn(),
  })),
  toasts: [],
  dismiss: vi.fn(),
});

/**
 * Setup global toast mock - only mocks sonner, not use-toast
 */
export function setupToastMock() {
  vi.mock("sonner", () => ({
    toast: Object.assign(
      vi.fn((message: string, options?: any) => "toast-id"),
      mockToast
    ),
    Toaster: vi.fn(() => null),
  }));

  // Don't mock use-toast by default - let tests import the real implementation
  // Tests that need to mock it can do so explicitly
}
