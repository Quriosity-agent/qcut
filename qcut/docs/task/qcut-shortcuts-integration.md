# QCut Keyboard Shortcuts Integration Guide

## Overview

This guide provides a roadmap for implementing or improving keyboard shortcuts functionality in QCut, based on the refactoring patterns from OpenCut commit aa5cd1ed.

## Current QCut Keyboard Shortcuts

### Existing Shortcuts (from codebase analysis)
QCut likely has keyboard shortcuts for:
- Play/Pause (Space)
- Timeline navigation (Arrow keys)
- Zoom in/out (Ctrl/Cmd + Plus/Minus)
- Save project (Ctrl/Cmd + S)
- Undo/Redo (Ctrl/Cmd + Z/Y)
- Cut/Copy/Paste (Ctrl/Cmd + X/C/V)

### Implementation Locations
Based on QCut's architecture, keyboard handling is likely in:
- `src/hooks/use-keyboard-shortcuts.ts` - Custom hook for shortcuts
- `src/components/editor/` - Editor-specific shortcuts
- `src/stores/` - Shortcut state management

## Implementation Plan

### Phase 1: Audit Current Implementation (10 minutes)

#### Step 1.1: Locate Keyboard Components
**Files to check**:
```bash
src/hooks/use-*.ts           # Custom hooks
src/components/**/*.tsx       # Component shortcuts
src/stores/*-store.ts        # Store-based shortcuts
src/lib/keyboard.ts          # Utility functions
```

#### Step 1.2: Identify Refactoring Opportunities
- Class components that could be converted
- Inline keyboard handlers that could be centralized
- Missing keyboard shortcut documentation

### Phase 2: Create Centralized Shortcut System (20 minutes)

#### Step 2.1: Create Shortcut Types
**File**: `src/types/shortcuts.ts`
```typescript
export interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  category: 'timeline' | 'playback' | 'editing' | 'file' | 'view' | 'help';
  keys: string[];
  action: () => void;
  enabled: boolean;
  customizable: boolean;
}

export interface ShortcutCategory {
  id: string;
  name: string;
  icon?: React.ComponentType;
  shortcuts: KeyboardShortcut[];
}
```

#### Step 2.2: Create Shortcut Store
**File**: `src/stores/shortcuts-store.ts`
```typescript
import { create } from 'zustand';
import { KeyboardShortcut } from '@/types/shortcuts';

interface ShortcutsStore {
  shortcuts: Map<string, KeyboardShortcut>;
  customShortcuts: Map<string, string[]>;
  isRecording: boolean;
  recordingId: string | null;
  
  // Actions
  registerShortcut: (shortcut: KeyboardShortcut) => void;
  unregisterShortcut: (id: string) => void;
  updateShortcutKeys: (id: string, keys: string[]) => void;
  startRecording: (id: string) => void;
  stopRecording: () => void;
  executeShortcut: (keys: string[]) => void;
  resetToDefaults: () => void;
  loadCustomShortcuts: () => void;
  saveCustomShortcuts: () => void;
}

export const useShortcutsStore = create<ShortcutsStore>((set, get) => ({
  shortcuts: new Map(),
  customShortcuts: new Map(),
  isRecording: false,
  recordingId: null,
  
  registerShortcut: (shortcut) => {
    set((state) => {
      const shortcuts = new Map(state.shortcuts);
      shortcuts.set(shortcut.id, shortcut);
      return { shortcuts };
    });
  },
  
  // ... implement other actions
}));
```

### Phase 3: Create Modern UI Components (15 minutes)

#### Step 3.1: Keyboard Shortcuts Help Dialog
**File**: `src/components/keyboard/shortcuts-help.tsx`
```typescript
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useShortcutsStore } from '@/stores/shortcuts-store';
import { KeyDisplay } from './key-display';

export function ShortcutsHelp({ open, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const { shortcuts } = useShortcutsStore();
  
  const filteredShortcuts = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return Array.from(shortcuts.values()).filter(
      shortcut => 
        shortcut.name.toLowerCase().includes(query) ||
        shortcut.description.toLowerCase().includes(query)
    );
  }, [shortcuts, searchQuery]);
  
  const groupedShortcuts = useMemo(() => {
    return filteredShortcuts.reduce((acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    }, {} as Record<string, typeof filteredShortcuts>);
  }, [filteredShortcuts]);
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        
        <Input
          placeholder="Search shortcuts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4"
        />
        
        <div className="overflow-y-auto flex-1">
          {Object.entries(groupedShortcuts).map(([category, shortcuts]) => (
            <ShortcutCategory
              key={category}
              category={category}
              shortcuts={shortcuts}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### Step 3.2: Key Display Component
**File**: `src/components/keyboard/key-display.tsx`
```typescript
export function KeyDisplay({ keys }: { keys: string[] }) {
  const formatKey = (key: string): string => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    
    const keyMap: Record<string, string> = {
      'mod': isMac ? '⌘' : 'Ctrl',
      'cmd': '⌘',
      'ctrl': 'Ctrl',
      'alt': isMac ? '⌥' : 'Alt',
      'shift': '⇧',
      'enter': '↵',
      'escape': 'Esc',
      'space': '␣',
      'backspace': '⌫',
      'delete': 'Del',
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→',
    };
    
    return keyMap[key.toLowerCase()] || key.toUpperCase();
  };
  
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 && <span className="text-muted-foreground mx-0.5">+</span>}
          <kbd className="px-2 py-0.5 text-xs font-semibold text-foreground bg-muted border border-border rounded">
            {formatKey(key)}
          </kbd>
        </span>
      ))}
    </div>
  );
}
```

### Phase 4: Create Custom Hook (10 minutes)

#### Step 4.1: useKeyboardShortcuts Hook
**File**: `src/hooks/use-keyboard-shortcuts.ts`
```typescript
import { useEffect, useCallback } from 'react';
import { useShortcutsStore } from '@/stores/shortcuts-store';

export function useKeyboardShortcuts() {
  const { executeShortcut, isRecording, recordingId, stopRecording } = useShortcutsStore();
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    // Build key combination
    const keys: string[] = [];
    if (e.metaKey || e.ctrlKey) keys.push('mod');
    if (e.altKey) keys.push('alt');
    if (e.shiftKey) keys.push('shift');
    
    const key = e.key.toLowerCase();
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
      keys.push(key);
    }
    
    if (keys.length > 0) {
      if (isRecording) {
        e.preventDefault();
        // Handle recording logic
      } else {
        executeShortcut(keys);
      }
    }
  }, [executeShortcut, isRecording]);
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  return {
    isRecording,
    recordingId,
    stopRecording,
  };
}
```

### Phase 5: Register Default Shortcuts (10 minutes)

#### Step 5.1: Default Shortcuts Configuration
**File**: `src/config/default-shortcuts.ts`
```typescript
import { KeyboardShortcut } from '@/types/shortcuts';

export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // Playback
  {
    id: 'play-pause',
    name: 'Play/Pause',
    description: 'Toggle playback',
    category: 'playback',
    keys: ['space'],
    action: () => {
      // Trigger play/pause
      const { toggle } = usePlaybackStore.getState();
      toggle();
    },
    enabled: true,
    customizable: true,
  },
  {
    id: 'skip-forward',
    name: 'Skip Forward',
    description: 'Skip forward 5 seconds',
    category: 'playback',
    keys: ['arrowright'],
    action: () => {
      const { skipForward } = usePlaybackStore.getState();
      skipForward(5);
    },
    enabled: true,
    customizable: true,
  },
  
  // Timeline
  {
    id: 'split-clip',
    name: 'Split Clip',
    description: 'Split clip at playhead',
    category: 'timeline',
    keys: ['mod', 'k'],
    action: () => {
      const { splitAtPlayhead } = useTimelineStore.getState();
      splitAtPlayhead();
    },
    enabled: true,
    customizable: true,
  },
  
  // File operations
  {
    id: 'save-project',
    name: 'Save Project',
    description: 'Save current project',
    category: 'file',
    keys: ['mod', 's'],
    action: () => {
      const { saveProject } = useProjectStore.getState();
      saveProject();
    },
    enabled: true,
    customizable: false,
  },
  
  // ... more shortcuts
];
```

#### Step 5.2: Initialize Shortcuts
**File**: `src/components/providers/shortcuts-provider.tsx`
```typescript
import { useEffect } from 'react';
import { useShortcutsStore } from '@/stores/shortcuts-store';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { DEFAULT_SHORTCUTS } from '@/config/default-shortcuts';

export function ShortcutsProvider({ children }) {
  const { registerShortcut, loadCustomShortcuts } = useShortcutsStore();
  
  // Initialize shortcuts
  useEffect(() => {
    // Load custom shortcuts from storage
    loadCustomShortcuts();
    
    // Register default shortcuts
    DEFAULT_SHORTCUTS.forEach(shortcut => {
      registerShortcut(shortcut);
    });
  }, []);
  
  // Setup global keyboard listener
  useKeyboardShortcuts();
  
  return <>{children}</>;
}
```

### Phase 6: Add to QCut UI (5 minutes)

#### Step 6.1: Add Help Menu Item
**File**: `src/components/header.tsx`
```typescript
import { ShortcutsHelp } from '@/components/keyboard/shortcuts-help';

export function Header() {
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  return (
    <>
      <header>
        {/* ... existing header content */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowShortcuts(true)}
        >
          Keyboard Shortcuts
        </Button>
      </header>
      
      <ShortcutsHelp
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </>
  );
}
```

## Testing Checklist

- [ ] All default shortcuts work correctly
- [ ] Shortcuts help dialog opens and displays all shortcuts
- [ ] Search functionality filters shortcuts properly
- [ ] Custom shortcut recording works
- [ ] Shortcuts are saved and persist across sessions
- [ ] Platform-specific keys display correctly (Mac vs Windows)
- [ ] Shortcuts don't trigger when typing in inputs
- [ ] No conflicts between shortcuts
- [ ] Performance is not impacted by shortcut system

## Migration Timeline

| Phase | Task | Time | Priority |
|-------|------|------|----------|
| 1 | Audit current implementation | 10 min | High |
| 2 | Create centralized system | 20 min | High |
| 3 | Create UI components | 15 min | Medium |
| 4 | Create custom hook | 10 min | High |
| 5 | Register default shortcuts | 10 min | High |
| 6 | Add to UI | 5 min | Medium |
| **Total** | **Complete Implementation** | **70 min** | |

## Benefits

1. **Centralized Management**: All shortcuts in one place
2. **Customizable**: Users can modify shortcuts
3. **Discoverable**: Help dialog shows all available shortcuts
4. **Modern Architecture**: Function components and hooks
5. **Type Safe**: Full TypeScript support
6. **Persistent**: Custom shortcuts saved to storage
7. **Cross-Platform**: Works on Mac and Windows

## Conclusion

This integration guide provides a complete roadmap for implementing a modern keyboard shortcuts system in QCut, inspired by OpenCut's refactoring approach. The implementation focuses on:

- Modern React patterns (hooks and function components)
- Centralized shortcut management
- User customization capabilities
- Clean, maintainable architecture

Following this guide will result in a professional keyboard shortcuts system that enhances user productivity and follows current best practices.