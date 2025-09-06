// Mock for Radix UI components to avoid getComputedStyle issues in tests
import React from 'react';

// Mock the problematic Presence component from Radix UI
export const mockPresence = {
  Presence: ({ children, present = true }: any) => {
    return present ? children : null;
  }
};

// Mock CheckboxIndicator to avoid Presence issues
export const mockCheckboxIndicator = React.forwardRef<any, any>(
  ({ children, ...props }, ref) => {
    return React.createElement('span', { ...props, ref }, children);
  }
);

// Setup function to be called in test setup
export function setupRadixUIMocks() {
  // Only mock in test environment
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    try {
      // Try to mock the Presence module
      const presenceModule = '@radix-ui/react-presence';
      if (require.cache[require.resolve(presenceModule)]) {
        require.cache[require.resolve(presenceModule)].exports = mockPresence;
      }
    } catch (e) {
      // Module not yet loaded, that's fine
    }
  }
}