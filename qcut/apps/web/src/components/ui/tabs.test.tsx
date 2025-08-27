import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

describe('Tabs Component', () => {
  it('renders tabs with default value', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );
    
    expect(screen.getByText('Tab 1')).toBeInTheDocument();
    expect(screen.getByText('Tab 2')).toBeInTheDocument();
    expect(screen.getByText('Content 1')).toBeInTheDocument();
    expect(screen.queryByText('Content 2')).not.toBeInTheDocument();
  });
  
  it('switches tabs on click', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );
    
    const tab2 = screen.getByText('Tab 2');
    fireEvent.click(tab2);
    
    // Check that Tab 2 is now selected
    expect(tab2).toHaveAttribute('aria-selected', 'true');
  });
  
  it('handles controlled value', () => {
    let currentValue = 'tab1';
    const handleChange = vi.fn((value) => {
      currentValue = value;
    });
    
    const { rerender } = render(
      <Tabs value={currentValue} onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );
    
    const tab2 = screen.getByText('Tab 2');
    fireEvent.click(tab2);
    
    // Verify callback was called
    expect(handleChange).toHaveBeenCalled();
    expect(handleChange).toHaveBeenCalledWith('tab2');
  });
  
  it('applies correct ARIA attributes', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList aria-label="Main tabs">
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
      </Tabs>
    );
    
    const tabList = screen.getByRole('tablist');
    const tab1 = screen.getByRole('tab', { name: 'Tab 1' });
    
    expect(tabList).toHaveAttribute('aria-label', 'Main tabs');
    expect(tab1).toHaveAttribute('aria-selected', 'true');
  });
});