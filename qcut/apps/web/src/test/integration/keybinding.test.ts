import { describe, it, expect, beforeEach } from 'vitest';
import { useKeybindingsStore, defaultKeybindings } from '@/stores/keybindings-store';

describe('Keybinding', () => {
  beforeEach(() => {
    useKeybindingsStore.setState({
      keybindings: { ...defaultKeybindings },
      customKeybindings: {},
    });
  });
  
  it('registers default keybinding', () => {
    const store = useKeybindingsStore.getState();
    expect(store.keybindings['space']).toBe('toggle-play');
    expect(store.keybindings['j']).toBe('seek-backward');
    expect(store.keybindings['k']).toBe('toggle-play');
  });
  
  it('updates custom keybinding', () => {
    const store = useKeybindingsStore.getState();
    store.updateKeybinding('a', 'add-marker');
    
    const updated = store.getKeybinding('a');
    expect(updated).toBe('add-marker');
  });
  
  it('resets to default keybindings', () => {
    const store = useKeybindingsStore.getState();
    store.updateKeybinding('space', 'custom-action');
    store.resetToDefaults();
    
    expect(store.keybindings['space']).toBe('toggle-play');
  });
});