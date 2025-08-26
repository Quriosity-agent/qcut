import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import React from 'react';

describe('Button Component', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
  });
  
  it('renders children correctly', () => {
    render(
      <Button>
        <span>Icon</span>
        <span>Text</span>
      </Button>
    );
    
    expect(screen.getByText('Icon')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
  });
  
  it('applies variant classes', () => {
    const { rerender } = render(<Button variant="default">Default</Button>);
    let button = screen.getByRole('button');
    expect(button.className).toContain('bg-foreground');
    expect(button.className).toContain('text-background');
    
    rerender(<Button variant="primary">Primary</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-primary-foreground');
    
    rerender(<Button variant="destructive">Destructive</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('bg-destructive');
    expect(button.className).toContain('text-destructive-foreground');
    
    rerender(<Button variant="outline">Outline</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('border');
    expect(button.className).toContain('border-input');
    
    rerender(<Button variant="secondary">Secondary</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('bg-secondary');
    expect(button.className).toContain('text-secondary-foreground');
    
    rerender(<Button variant="text">Text</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('bg-transparent');
    expect(button.className).toContain('p-0');
    
    rerender(<Button variant="link">Link</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('text-primary');
    expect(button.className).toContain('underline-offset-4');
  });
  
  it('applies size classes', () => {
    const { rerender } = render(<Button size="default">Default</Button>);
    let button = screen.getByRole('button');
    expect(button.className).toContain('h-9');
    expect(button.className).toContain('px-4');
    
    rerender(<Button size="sm">Small</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('h-8');
    expect(button.className).toContain('px-3');
    expect(button.className).toContain('text-xs');
    
    rerender(<Button size="lg">Large</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('h-10');
    expect(button.className).toContain('px-8');
    
    rerender(<Button size="icon">Icon</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('h-7');
    expect(button.className).toContain('w-7');
  });
  
  it('handles click events', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  
  it('handles multiple clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Multi-click</Button>);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    
    expect(onClick).toHaveBeenCalledTimes(3);
  });
  
  it('disables button when disabled prop is true', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    const button = screen.getByRole('button');
    
    expect(button).toBeDisabled();
    expect(button.className).toContain('disabled:opacity-50');
    expect(button.className).toContain('disabled:pointer-events-none');
    
    // Click should not work when disabled
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  
  it('applies custom className', () => {
    render(<Button className="custom-class another-class">Custom</Button>);
    const button = screen.getByRole('button');
    
    expect(button.className).toContain('custom-class');
    expect(button.className).toContain('another-class');
    // Should still have default classes
    expect(button.className).toContain('inline-flex');
    expect(button.className).toContain('items-center');
  });
  
  it('renders as child component when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>
    );
    
    const link = screen.getByRole('link', { name: 'Link Button' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/test');
    // Button classes should be applied to the child
    expect(link.className).toContain('inline-flex');
    expect(link.className).toContain('items-center');
  });
  
  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref Button</Button>);
    
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe('Ref Button');
  });
  
  it('handles type attribute', () => {
    const { rerender } = render(<Button type="button">Button Type</Button>);
    let button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    
    rerender(<Button type="submit">Submit Type</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'submit');
    
    rerender(<Button type="reset">Reset Type</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'reset');
  });
  
  it('handles aria attributes', () => {
    render(
      <Button
        aria-label="Custom label"
        aria-pressed="true"
        aria-disabled="false"
      >
        Aria Button
      </Button>
    );
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Custom label');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
  
  it('handles data attributes', () => {
    render(
      <Button
        data-testid="test-button"
        data-custom="value"
      >
        Data Button
      </Button>
    );
    
    const button = screen.getByTestId('test-button');
    expect(button).toHaveAttribute('data-custom', 'value');
  });
  
  it('combines variant and size props correctly', () => {
    render(
      <Button variant="primary" size="lg">
        Primary Large
      </Button>
    );
    
    const button = screen.getByRole('button');
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('h-10');
    expect(button.className).toContain('px-8');
  });
  
  it('handles focus and hover states', () => {
    render(<Button>Interactive</Button>);
    const button = screen.getByRole('button');
    
    // Check for focus classes
    expect(button.className).toContain('focus-visible:outline-hidden');
    expect(button.className).toContain('focus-visible:ring-1');
    
    // Check for hover classes (variant-dependent)
    expect(button.className).toContain('hover:bg-foreground/90');
  });
  
  it('handles SVG icon styling', () => {
    render(
      <Button>
        <svg className="test-svg">
          <rect />
        </svg>
        Icon Button
      </Button>
    );
    
    const button = screen.getByRole('button');
    // Button should have SVG-specific classes
    expect(button.className).toContain('[&_svg]:pointer-events-none');
    expect(button.className).toContain('[&_svg]:size-4');
    expect(button.className).toContain('[&_svg]:shrink-0');
  });
});