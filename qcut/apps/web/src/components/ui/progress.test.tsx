import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress } from '@/components/ui/progress';

describe('Progress Component', () => {
  it('renders with default value', () => {
    const { container } = render(<Progress />);
    const progressBar = container.querySelector('[role="progressbar"]');
    
    expect(progressBar).toBeInTheDocument();
  });
  
  it('shows specific progress value', () => {
    const { container } = render(<Progress value={50} />);
    const progressBar = container.querySelector('[role="progressbar"]');
    const indicator = progressBar?.firstChild as HTMLElement;
    
    expect(progressBar).toBeInTheDocument();
    expect(indicator).toHaveStyle({ transform: 'translateX(-50%)' });
  });
  
  it('handles 100% completion', () => {
    const { container } = render(<Progress value={100} />);
    const progressBar = container.querySelector('[role="progressbar"]');
    const indicator = progressBar?.firstChild as HTMLElement;
    
    expect(progressBar).toBeInTheDocument();
    expect(indicator).toHaveStyle({ transform: 'translateX(0%)' });
  });
  
  it('clamps values between 0 and 100', () => {
    const { container, rerender } = render(<Progress value={-10} />);
    let indicator = container.querySelector('[role="progressbar"]')?.firstChild as HTMLElement;
    
    // Negative value should be clamped to 0 (translateX(-100%))
    expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
    
    rerender(<Progress value={150} />);
    indicator = container.querySelector('[role="progressbar"]')?.firstChild as HTMLElement;
    
    // Value > 100 should be clamped to 100 (translateX(0%))
    expect(indicator).toHaveStyle({ transform: 'translateX(0%)' });
  });
  
  it('updates dynamically', () => {
    const { container, rerender } = render(<Progress value={25} />);
    let indicator = container.querySelector('[role="progressbar"]')?.firstChild as HTMLElement;
    
    expect(indicator).toHaveStyle({ transform: 'translateX(-75%)' });
    
    rerender(<Progress value={75} />);
    indicator = container.querySelector('[role="progressbar"]')?.firstChild as HTMLElement;
    
    expect(indicator).toHaveStyle({ transform: 'translateX(-25%)' });
  });
});