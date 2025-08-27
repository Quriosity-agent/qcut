import { render, RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: CustomRenderOptions
): ReturnType<typeof render> {
  const { initialRoute = '/', ...renderOptions } = options || {};
  
  // Honor the requested initial route for components that read window.location.
  // When TanStack Router is needed, replace this with proper memory history setup.
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', initialRoute);
  }
  
  const Wrapper = ({ children }: { children: ReactNode }) => {
    return children;
  };
  
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}