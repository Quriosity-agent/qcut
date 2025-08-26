import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: CustomRenderOptions
) {
  const { initialRoute = '/', ...renderOptions } = options || {};
  
  // Create test router with memory history
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return children;
  };
  
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}