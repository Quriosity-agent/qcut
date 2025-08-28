import { vi } from "vitest";

/**
 * Mock for TanStack Router (not Next.js router)
 */
export const mockRouter = {
  navigate: vi.fn().mockResolvedValue(undefined),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),

  // Router state
  pathname: "/",
  search: "",
  hash: "",
  state: {},
  params: {} as Record<string, string>,

  // Navigation state
  isNavigating: false,
  isLoading: false,
};

/**
 * Mock useParams hook
 */
export const mockUseParams = <T = Record<string, string>>() => {
  return mockRouter.params as T;
};

/**
 * Mock useNavigate hook
 */
export const mockUseNavigate = () => {
  return mockRouter.navigate;
};

/**
 * Setup router mocks for TanStack Router
 */
export function setupRouterMock() {
  vi.mock("@tanstack/react-router", () => ({
    useRouter: () => mockRouter,
    useParams: mockUseParams,
    useNavigate: mockUseNavigate,
    useLocation: () => ({
      pathname: mockRouter.pathname,
      search: mockRouter.search,
      hash: mockRouter.hash,
    }),
    Link: vi.fn(({ children }) => children),
    Outlet: vi.fn(() => null),
  }));
}
