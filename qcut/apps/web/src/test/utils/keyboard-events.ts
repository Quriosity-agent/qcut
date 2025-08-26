/**
 * Create keyboard events for testing keyboard shortcuts
 */
export function createKeyboardEvent(
  type: 'keydown' | 'keyup' | 'keypress',
  key: string,
  options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  return new KeyboardEvent(type, {
    key,
    code: getKeyCode(key),
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

/**
 * Map common keys to their key codes
 */
function getKeyCode(key: string): string {
  const keyCodes: Record<string, string> = {
    'Enter': 'Enter',
    ' ': 'Space',
    'Escape': 'Escape',
    'Delete': 'Delete',
    'Backspace': 'Backspace',
    'Tab': 'Tab',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'a': 'KeyA',
    's': 'KeyS',
    'd': 'KeyD',
    'z': 'KeyZ',
    'x': 'KeyX',
    'c': 'KeyC',
    'v': 'KeyV',
  };
  
  return keyCodes[key] || `Key${key.toUpperCase()}`;
}

/**
 * Create common keyboard shortcuts for testing
 */
export const shortcuts = {
  // Timeline shortcuts
  play: () => createKeyboardEvent('keydown', ' '),
  stop: () => createKeyboardEvent('keydown', 'Escape'),
  
  // Edit shortcuts
  undo: () => createKeyboardEvent('keydown', 'z', { ctrlKey: true }),
  redo: () => createKeyboardEvent('keydown', 'y', { ctrlKey: true }),
  cut: () => createKeyboardEvent('keydown', 'x', { ctrlKey: true }),
  copy: () => createKeyboardEvent('keydown', 'c', { ctrlKey: true }),
  paste: () => createKeyboardEvent('keydown', 'v', { ctrlKey: true }),
  delete: () => createKeyboardEvent('keydown', 'Delete'),
  
  // Navigation
  home: () => createKeyboardEvent('keydown', 'Home'),
  end: () => createKeyboardEvent('keydown', 'End'),
  
  // Selection
  selectAll: () => createKeyboardEvent('keydown', 'a', { ctrlKey: true }),
  
  // Timeline zoom
  zoomIn: () => createKeyboardEvent('keydown', '+', { ctrlKey: true }),
  zoomOut: () => createKeyboardEvent('keydown', '-', { ctrlKey: true }),
};

/**
 * Simulate typing text
 */
export function typeText(element: HTMLElement, text: string) {
  text.split('').forEach(char => {
    element.dispatchEvent(createKeyboardEvent('keydown', char));
    element.dispatchEvent(createKeyboardEvent('keypress', char));
    element.dispatchEvent(createKeyboardEvent('keyup', char));
  });
}