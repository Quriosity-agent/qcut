# Run Skill → Gemini CLI Integration Plan

## Overview
When a user clicks "Run" on a skill, the app should:
1. Switch to the **PTY Terminal** tab (Gemini CLI mode)
2. Set the skill as active context in the store
3. Auto-start Gemini CLI if not running
4. Send skill instructions to Gemini CLI as the first prompt

## Existing Infrastructure (Reuse)

### PTY Terminal (Gemini CLI)
- **Component**: `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`
- **Store**: `apps/web/src/stores/pty-terminal-store.ts`
- **Tab**: `pty` in `useMediaPanelStore`
- **Command**: `npx @google/gemini-cli@latest` (when `isGeminiMode: true`)
- **API**: `window.electronAPI.pty.spawn()`, `window.electronAPI.pty.write()`

### Key Store Methods
- `connect()` - Spawns PTY session with Gemini CLI
- `setGeminiMode(true)` - Ensures Gemini CLI mode
- `window.electronAPI.pty.write(sessionId, data)` - Sends input to terminal

### Media Panel Tab System
- **Store**: `apps/web/src/components/editor/media-panel/store.ts`
- **Switch tab**: `useMediaPanelStore().setActiveTab('pty')`

## Implementation Tasks

### Task 1: Add Skill Context to PTY Terminal Store
**File**: `apps/web/src/stores/pty-terminal-store.ts`

Add skill context state:
```typescript
interface PtyTerminalState {
  // ... existing state
  activeSkill: {
    id: string;
    name: string;
    content: string;
  } | null;
  skillPromptSent: boolean; // Track if initial skill prompt was sent
}

interface PtyTerminalActions {
  // ... existing actions
  setActiveSkill: (skill: { id: string; name: string; content: string } | null) => void;
  clearSkillContext: () => void;
  markSkillPromptSent: () => void;
}
```

### Task 2: Create Skill Runner Hook
**File**: `apps/web/src/hooks/use-skill-runner.ts` (NEW)

```typescript
import { useSkillsStore } from "@/stores/skills-store";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";

export function useSkillRunner() {
  const { skills } = useSkillsStore();
  const {
    setActiveSkill,
    setGeminiMode,
    connect,
    status,
    sessionId
  } = usePtyTerminalStore();
  const { setActiveTab } = useMediaPanelStore();

  const runSkill = async (skillId: string) => {
    const skill = skills.find(s => s.id === skillId);
    if (!skill) return;

    // 1. Set skill as active context
    setActiveSkill({
      id: skill.id,
      name: skill.name,
      content: skill.content,
    });

    // 2. Ensure Gemini CLI mode
    setGeminiMode(true);

    // 3. Switch to PTY terminal tab
    setActiveTab("pty");

    // 4. Auto-start Gemini CLI if not connected
    if (status !== "connected") {
      await connect();
    }
  };

  return { runSkill };
}
```

### Task 3: Send Skill Prompt When Connected
**File**: `apps/web/src/stores/pty-terminal-store.ts`

After Gemini CLI connects, if there's an active skill, send the prompt:
```typescript
handleConnected: (sessionId) => {
  const { activeSkill, skillPromptSent } = get();
  set({ sessionId, status: "connected" });

  // If skill is active and prompt not sent, send it
  if (activeSkill && !skillPromptSent) {
    const prompt = buildSkillPrompt(activeSkill);
    // Small delay to let Gemini CLI initialize
    setTimeout(() => {
      window.electronAPI?.pty?.write(sessionId, prompt + "\n");
      set({ skillPromptSent: true });
    }, 1000);
  }
},
```

Helper function:
```typescript
function buildSkillPrompt(skill: { name: string; content: string }): string {
  return `I'm using the "${skill.name}" skill. Here are the instructions:

${skill.content}

Please follow these instructions for our conversation. What would you like me to help you with?`;
}
```

### Task 4: Connect Skill Card Run Button
**File**: `apps/web/src/components/editor/media-panel/skill-card.tsx`

```typescript
import { useSkillRunner } from "@/hooks/use-skill-runner";

export function SkillCard({ skill }: SkillCardProps) {
  const { runSkill } = useSkillRunner();

  return (
    <Button onClick={() => runSkill(skill.id)}>
      <Play className="h-4 w-4" />
      Run
    </Button>
  );
}
```

### Task 5: Add Skill Indicator to PTY Terminal Header
**File**: `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

Show active skill badge in the header:
```tsx
const { activeSkill, clearSkillContext } = usePtyTerminalStore();

{/* Add after mode toggle */}
{activeSkill && (
  <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 rounded-full">
    <Brain className="h-3 w-3 text-purple-500" />
    <span className="text-xs text-purple-600">{activeSkill.name}</span>
    <button
      type="button"
      onClick={clearSkillContext}
      className="ml-1 hover:text-destructive"
      aria-label="Clear skill context"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
)}
```

### Task 6: Update Empty State When Skill Is Active
**File**: `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

```tsx
{/* Terminal Area - empty state */}
{!isConnected && !isConnecting && (
  <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
    {activeSkill ? (
      <>
        <Brain className="h-12 w-12 mb-4 text-purple-500" />
        <p className="text-sm font-medium">{activeSkill.name}</p>
        <p className="text-xs mt-1">Click Start to run with Gemini CLI</p>
      </>
    ) : (
      <>
        <TerminalIcon className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">
          {isGeminiMode
            ? "Click Start to launch Gemini CLI"
            : "Click Start to open a terminal"}
        </p>
      </>
    )}
  </div>
)}
```

## User Flow

```
User in Skills Panel
        ↓
Clicks "Run" on "AI Content Pipeline"
        ↓
┌─────────────────────────────────────┐
│  Media Panel → PTY Tab (auto)       │
│  ┌───────────────────────────────┐  │
│  │ [x] Gemini CLI                │  │
│  │ 🧠 AI Content Pipeline [×]   │  │  ← Skill badge
│  │ ● connected         [Restart] │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ $ npx @google/gemini-cli      │  │
│  │                               │  │
│  │ > I'm using the "AI Content   │  │  ← Auto-sent skill prompt
│  │   Pipeline" skill...          │  │
│  │                               │  │
│  │ Gemini: I understand! I'll    │  │
│  │ follow the pipeline...        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Files to Modify/Create

| File | Action | Description |
|------|--------|-------------|
| `stores/pty-terminal-store.ts` | Modify | Add `activeSkill`, `setActiveSkill`, `clearSkillContext`, `skillPromptSent` |
| `hooks/use-skill-runner.ts` | Create | Hook to run skill (sets context + switches tab + auto-connect) |
| `components/editor/media-panel/skill-card.tsx` | Modify | Connect Run button to `useSkillRunner` |
| `components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Modify | Show skill badge + update empty state |

## Technical Notes

1. **Skill Prompt Injection**: When Gemini CLI connects and a skill is active, automatically send the skill content as the first prompt

2. **Tab Switching**: Uses `useMediaPanelStore().setActiveTab('pty')` to navigate to PTY terminal

3. **Auto-Connect**: If terminal isn't running, automatically start it when running a skill

4. **Prompt Timing**: Use a small delay (1s) after connection to let Gemini CLI initialize before sending skill prompt

5. **Clear Context**: User can clear skill context which resets `activeSkill` and `skillPromptSent`

## Success Criteria

- [ ] Clicking "Run" switches to PTY terminal tab
- [ ] Gemini CLI mode is automatically enabled
- [ ] Terminal auto-starts if not connected
- [ ] Skill prompt is automatically sent to Gemini CLI
- [ ] Skill badge shows in terminal header when skill is active
- [ ] User can clear skill context
- [ ] Works with both bundled and imported skills
