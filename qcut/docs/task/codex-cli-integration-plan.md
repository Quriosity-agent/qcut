# Dual CLI Provider Support: Gemini CLI + Codex (OpenRouter)

**Feature:** Add multi-provider CLI support - users can choose between Gemini CLI or Codex (OpenRouter)
**Branch:** `feature/dual-cli-providers`
**Priority:** High
**Estimated Effort:** Large (8 subtasks, ~12-16 hours total)

---

## Overview

QCut supports **both** Gemini CLI and Codex CLI as AI coding agents. Users can select their preferred provider:

| Provider | Models | Authentication | Best For |
|----------|--------|----------------|----------|
| **Gemini CLI** | Gemini Pro, Gemini Flash | Google OAuth | Users with Google accounts, free tier access |
| **Codex (OpenRouter)** | 300+ models (Claude, GPT-4, Gemini, etc.) | API Key | Power users, model flexibility, pay-per-use |

Both providers fully support the QCut skills system. Users can switch between providers at any time.

### Why Dual Support?

1. **Gemini CLI** is free with a Google account - great for getting started
2. **Codex/OpenRouter** offers 300+ models including Claude, GPT-4, Llama, etc.
3. **No vendor lock-in** - users choose based on their needs
4. **Skills work with both** - same skill files, different AI backends

---

## Current State Analysis

### Existing Architecture

| Component | File Path | Purpose |
|-----------|-----------|---------|
| PTY Terminal Store | `apps/web/src/stores/pty-terminal-store.ts` | Terminal state, connection, skill context |
| Skill Runner Hook | `apps/web/src/hooks/use-skill-runner.ts` | Runs skills with Gemini CLI |
| PTY Terminal View | `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Terminal UI with mode toggle |
| Terminal Emulator | `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` | xterm.js wrapper |
| API Key Handler | `electron/api-key-handler.ts` | Secure storage for API keys |
| PTY Handler | `electron/pty-handler.ts` | Spawns PTY sessions |

### Current Flow (Gemini Only)
```
User clicks "Run Skill" → use-skill-runner.ts
    → setActiveSkill()
    → setGeminiMode(true)
    → connect() spawns "npx @google/gemini-cli@latest"
    → After 2s delay, sendSkillPrompt() injects skill content
```

### New Flow (Dual Provider Support)
```
User clicks "Run Skill" → use-skill-runner.ts
    → setActiveSkill()
    → setCliProvider("gemini" | "codex")
    → connect() builds command based on provider:

        Gemini CLI:
        → spawn "npx @google/gemini-cli@latest"
        → After 2s delay, sendSkillPrompt() injects skill content

        Codex (OpenRouter):
        → Get OpenRouter API key from secure storage
        → spawn "npx open-codex --provider openrouter --model X --system-prompt SKILL"
        → Skill injected via command flag (no delay needed)
```

### Gap Analysis (What We're Adding)
- ✅ Currently supports Gemini CLI (keeping this)
- ❌ No provider selection UI (adding dropdown)
- ❌ No OpenRouter API key storage (adding to Settings)
- ❌ No model selection for alternative providers (adding model dropdown)
- ❌ Skill injection only works via Gemini prompt (adding --system-prompt flag for Codex)

---

## Implementation Tasks

### Task 1: Define CLI Provider Types

**Estimated Time:** 30 minutes

**Files to create:**
- `apps/web/src/types/cli-provider.ts`

**Implementation:**
```typescript
/**
 * Supported CLI providers for AI coding agents.
 */
export type CliProvider = "gemini" | "codex" | "shell";

/**
 * Configuration for each CLI provider.
 */
export interface CliProviderConfig {
  id: CliProvider;
  name: string;
  description: string;
  command: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  supportsSkillFlag: boolean;
  skillFlagFormat?: string; // e.g., "--system-prompt" or "--message-file"
}

/**
 * Provider configurations.
 */
export const CLI_PROVIDERS: Record<CliProvider, CliProviderConfig> = {
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's Gemini AI assistant",
    command: "npx @google/gemini-cli@latest",
    requiresApiKey: false, // Uses OAuth
    supportsSkillFlag: false, // Uses prompt injection
  },
  codex: {
    id: "codex",
    name: "Codex (OpenRouter)",
    description: "Multi-model AI via OpenRouter (300+ models)",
    command: "npx open-codex",
    requiresApiKey: true,
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    supportsSkillFlag: true,
    skillFlagFormat: "--system-prompt",
  },
  shell: {
    id: "shell",
    name: "Shell",
    description: "Standard terminal shell",
    command: "", // Uses default shell
    requiresApiKey: false,
    supportsSkillFlag: false,
  },
};

/**
 * Available models for Codex/OpenRouter.
 */
export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

/**
 * Default models to show in selector.
 */
export const DEFAULT_OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    contextLength: 200000,
    pricing: { prompt: 0.003, completion: 0.015 },
  },
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    provider: "Anthropic",
    contextLength: 200000,
    pricing: { prompt: 0.015, completion: 0.075 },
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextLength: 128000,
    pricing: { prompt: 0.005, completion: 0.015 },
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    contextLength: 1000000,
    pricing: { prompt: 0.00125, completion: 0.005 },
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    provider: "DeepSeek",
    contextLength: 64000,
    pricing: { prompt: 0.00014, completion: 0.00028 },
  },
];
```

**Unit Tests:**
- `apps/web/src/types/__tests__/cli-provider.test.ts`
  - Verify CLI_PROVIDERS has all required fields
  - Verify DEFAULT_OPENROUTER_MODELS structure

---

### Task 2: Update API Key Handler for OpenRouter

**Estimated Time:** 1 hour

**Files to modify:**
- `electron/api-key-handler.ts`
- `apps/web/src/types/electron.d.ts`

**Changes to `api-key-handler.ts`:**
```typescript
// Update interfaces (line 6-16)
interface ApiKeys {
  falApiKey: string;
  freesoundApiKey: string;
  geminiApiKey: string;
  openRouterApiKey: string; // NEW
}

interface ApiKeyData {
  falApiKey?: string;
  freesoundApiKey?: string;
  geminiApiKey?: string;
  openRouterApiKey?: string; // NEW
}
```

Add encryption/decryption for `openRouterApiKey` following existing pattern (lines 56-102).

**Changes to `electron.d.ts`:**
```typescript
// Update ApiKeys interface to include openRouterApiKey
interface ApiKeys {
  falApiKey: string;
  freesoundApiKey: string;
  geminiApiKey: string;
  openRouterApiKey: string;
}
```

**Unit Tests:**
- `electron/__tests__/api-key-handler.test.ts`
  - Test OpenRouter key encryption/decryption
  - Test backward compatibility (missing key returns empty string)

---

### Task 3: Update PTY Terminal Store

**Estimated Time:** 2 hours

**Files to modify:**
- `apps/web/src/stores/pty-terminal-store.ts`

**Changes:**

1. **Import new types:**
```typescript
import type { CliProvider } from "@/types/cli-provider";
import { CLI_PROVIDERS } from "@/types/cli-provider";
```

2. **Update state interface (line 18-36):**
```typescript
interface PtyTerminalState {
  // Session state
  sessionId: string | null;
  status: ConnectionStatus;
  exitCode: number | null;
  error: string | null;

  // Terminal dimensions
  cols: number;
  rows: number;

  // CLI provider state (replaces isGeminiMode)
  cliProvider: CliProvider;
  selectedModel: string | null; // For Codex/OpenRouter

  // Legacy compatibility
  isGeminiMode: boolean; // Derived from cliProvider

  workingDirectory: string;

  // Skill context
  activeSkill: ActiveSkillContext | null;
  skillPromptSent: boolean;
}
```

3. **Update actions interface (line 38-63):**
```typescript
interface PtyTerminalActions {
  // ... existing actions

  // CLI provider management (replaces setGeminiMode)
  setCliProvider: (provider: CliProvider) => void;
  setSelectedModel: (modelId: string | null) => void;

  // Legacy compatibility
  setGeminiMode: (enabled: boolean) => void; // Maps to setCliProvider
}
```

4. **Update initial state (line 71-82):**
```typescript
const initialState: PtyTerminalState = {
  sessionId: null,
  status: "disconnected",
  exitCode: null,
  error: null,
  cols: 80,
  rows: 24,
  cliProvider: "gemini", // Default to Gemini for backward compatibility
  selectedModel: "anthropic/claude-sonnet-4", // Default Codex model
  isGeminiMode: true, // Derived
  workingDirectory: "",
  activeSkill: null,
  skillPromptSent: false,
};
```

5. **Update connect() to build command based on provider (line 102-153):**
```typescript
connect: async (options = {}) => {
  const { cliProvider, selectedModel, workingDirectory, cols, rows, activeSkill } = get();

  set({ status: "connecting", error: null, exitCode: null });

  try {
    if (!window.electronAPI?.pty) {
      set({ status: "error", error: "PTY is only available in the desktop app." });
      return;
    }

    // Build command based on provider
    let command: string | undefined;
    let env: Record<string, string> = {};

    const providerConfig = CLI_PROVIDERS[cliProvider];

    if (cliProvider === "codex") {
      // Get OpenRouter API key
      const apiKeys = await window.electronAPI?.apiKeys?.get();
      if (!apiKeys?.openRouterApiKey) {
        set({ status: "error", error: "OpenRouter API key not configured. Go to Settings > API Keys." });
        return;
      }

      env.OPENROUTER_API_KEY = apiKeys.openRouterApiKey;

      // Build Codex command with model and optional skill
      command = `npx open-codex --provider openrouter`;
      if (selectedModel) {
        command += ` --model ${selectedModel}`;
      }

      // Inject skill via --system-prompt flag if active
      if (activeSkill && providerConfig.supportsSkillFlag) {
        const escapedContent = activeSkill.content.replace(/"/g, '\\"');
        command += ` --system-prompt "${escapedContent}"`;
      }
    } else if (cliProvider === "gemini") {
      command = "npx @google/gemini-cli@latest";
    }
    // shell provider uses undefined command (default shell)

    const spawnOptions = {
      cols,
      rows,
      cwd: options.cwd || workingDirectory || undefined,
      command: options.command || command,
      env, // Pass environment variables
    };

    const result = await window.electronAPI.pty.spawn(spawnOptions);

    if (result?.success && result.sessionId) {
      set({ sessionId: result.sessionId, status: "connected" });
    } else {
      set({ status: "error", error: result?.error ?? "Failed to spawn PTY session" });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to spawn PTY session";
    set({ status: "error", error: message });
  }
},
```

6. **Add new actions:**
```typescript
setCliProvider: (provider) => {
  set({
    cliProvider: provider,
    isGeminiMode: provider === "gemini",
  });
},

setSelectedModel: (modelId) => {
  set({ selectedModel: modelId });
},

// Legacy compatibility
setGeminiMode: (enabled) => {
  set({
    cliProvider: enabled ? "gemini" : "shell",
    isGeminiMode: enabled,
  });
},
```

7. **Update sendSkillPrompt() to only work for Gemini (line 191-205):**
```typescript
sendSkillPrompt: () => {
  const { sessionId, activeSkill, skillPromptSent, cliProvider } = get();

  // Only send prompt injection for Gemini (Codex uses --system-prompt flag)
  if (!activeSkill || skillPromptSent || cliProvider !== "gemini" || !sessionId) {
    return;
  }

  const prompt = buildSkillPrompt(activeSkill);
  window.electronAPI?.pty?.write(sessionId, prompt + "\n");
  set({ skillPromptSent: true });
},
```

**Unit Tests:**
- `apps/web/src/stores/__tests__/pty-terminal-store.test.ts`
  - Test setCliProvider updates isGeminiMode
  - Test connect() builds correct command for each provider
  - Test Codex requires API key
  - Test skill injection via flag for Codex

---

### Task 4: Update PTY Handler for Environment Variables

**Estimated Time:** 1 hour

**Files to modify:**
- `electron/pty-handler.ts`

**Changes to SpawnOptions interface (line 36-41):**
```typescript
interface SpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  command?: string;
  env?: Record<string, string>; // NEW: Additional environment variables
}
```

**Update pty.spawn call (line 152-158):**
```typescript
const ptyProcess = pty.spawn(shell, args, {
  name: "xterm-256color",
  cols: options.cols || 80,
  rows: options.rows || 24,
  cwd: options.cwd || process.cwd(),
  env: {
    ...process.env,
    ...options.env, // Merge additional env vars (e.g., OPENROUTER_API_KEY)
  },
});
```

**Unit Tests:**
- `electron/__tests__/pty-handler.test.ts`
  - Test environment variables are passed to spawned process
  - Test env merge doesn't override critical system vars

---

### Task 5: Update Skill Runner Hook

**Estimated Time:** 1 hour

**Files to modify:**
- `apps/web/src/hooks/use-skill-runner.ts`

**Updated implementation:**
```typescript
import { useCallback } from "react";
import { useSkillsStore } from "@/stores/skills-store";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";
import { useProjectStore } from "@/stores/project-store";
import { CLI_PROVIDERS } from "@/types/cli-provider";

/**
 * Hook to run a skill with the configured CLI provider.
 *
 * For Gemini CLI: Injects skill via prompt after connection.
 * For Codex: Passes skill via --system-prompt flag at spawn time.
 */
export function useSkillRunner() {
  const { skills } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const {
    setActiveSkill,
    setCliProvider,
    setWorkingDirectory,
    connect,
    disconnect,
    status,
    cliProvider,
  } = usePtyTerminalStore();
  const { setActiveTab } = useMediaPanelStore();

  const runSkill = useCallback(
    async (skillId: string, preferredProvider?: "gemini" | "codex") => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) {
        console.warn("[useSkillRunner] Skill not found:", skillId);
        return;
      }

      if (!activeProject) {
        console.warn("[useSkillRunner] No active project");
        return;
      }

      console.log("[useSkillRunner] Running skill:", skill.name, "with provider:", preferredProvider || cliProvider);

      // 1. Get the project's skills folder path
      let skillsPath = "";
      try {
        if (window.electronAPI?.skills?.getPath) {
          skillsPath = await window.electronAPI.skills.getPath(activeProject.id);
        }
      } catch (error) {
        console.error("[useSkillRunner] Failed to get skills path:", error);
      }

      // 2. Set skill as active context (used by both providers)
      setActiveSkill({
        id: skill.id,
        name: skill.name,
        content: skill.content,
      });

      // 3. Set provider if specified
      if (preferredProvider) {
        setCliProvider(preferredProvider);
      }

      // 4. Set working directory
      if (skillsPath) {
        setWorkingDirectory(skillsPath);
      }

      // 5. Switch to PTY terminal tab
      setActiveTab("pty");

      // 6. Reconnect to apply new skill context
      if (status === "connected") {
        await disconnect();
        setTimeout(() => connect(), 200);
      } else if (status !== "connecting") {
        await connect();
      }
    },
    [skills, activeProject, setActiveSkill, setCliProvider, setWorkingDirectory, setActiveTab, connect, disconnect, status, cliProvider]
  );

  return { runSkill };
}
```

**Unit Tests:**
- `apps/web/src/hooks/__tests__/use-skill-runner.test.ts`
  - Test runSkill with Gemini provider
  - Test runSkill with Codex provider
  - Test preferredProvider override

---

### Task 6: Update PTY Terminal View UI

**Estimated Time:** 2 hours

**Files to modify:**
- `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

**Changes:**

1. **Import new types and components:**
```typescript
import type { CliProvider } from "@/types/cli-provider";
import { CLI_PROVIDERS, DEFAULT_OPENROUTER_MODELS } from "@/types/cli-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bot } from "lucide-react"; // Icon for Codex
```

2. **Update store destructuring (line 21-33):**
```typescript
const {
  sessionId,
  status,
  exitCode,
  error,
  cliProvider,
  selectedModel,
  activeSkill,
  connect,
  disconnect,
  setCliProvider,
  setSelectedModel,
  clearSkillContext,
} = usePtyTerminalStore();
```

3. **Replace Switch with Provider Selector (line 70-95):**
```tsx
{/* Provider Selector */}
<div className="flex items-center gap-2">
  <Select
    value={cliProvider}
    onValueChange={(value: CliProvider) => setCliProvider(value)}
    disabled={isConnected || isConnecting}
  >
    <SelectTrigger className="w-[140px] h-8" aria-label="Select CLI provider">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {Object.values(CLI_PROVIDERS).map((provider) => (
        <SelectItem key={provider.id} value={provider.id}>
          <div className="flex items-center gap-2">
            {provider.id === "gemini" && <Sparkles className="h-3 w-3" />}
            {provider.id === "codex" && <Bot className="h-3 w-3" />}
            {provider.id === "shell" && <TerminalIcon className="h-3 w-3" />}
            <span>{provider.name}</span>
          </div>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>

  {/* Model Selector (only for Codex) */}
  {cliProvider === "codex" && (
    <Select
      value={selectedModel || ""}
      onValueChange={setSelectedModel}
      disabled={isConnected || isConnecting}
    >
      <SelectTrigger className="w-[180px] h-8" aria-label="Select AI model">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {DEFAULT_OPENROUTER_MODELS.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <div className="flex flex-col">
              <span>{model.name}</span>
              <span className="text-xs text-muted-foreground">{model.provider}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )}
</div>
```

4. **Update placeholder text (line 205-234):**
```tsx
<div className="h-full flex flex-col items-center justify-center text-muted-foreground">
  {activeSkill ? (
    <>
      <Brain className="h-12 w-12 mb-4 text-purple-500" />
      <p className="text-sm font-medium text-foreground">{activeSkill.name}</p>
      <p className="text-xs mt-1 opacity-70">
        Click Start to run with {CLI_PROVIDERS[cliProvider].name}
      </p>
      {cliProvider === "codex" && (
        <p className="text-xs mt-2 text-blue-400">
          Using model: {selectedModel || "default"}
        </p>
      )}
    </>
  ) : (
    <>
      {cliProvider === "gemini" && <Sparkles className="h-12 w-12 mb-4 opacity-50" />}
      {cliProvider === "codex" && <Bot className="h-12 w-12 mb-4 opacity-50" />}
      {cliProvider === "shell" && <TerminalIcon className="h-12 w-12 mb-4 opacity-50" />}
      <p className="text-sm">
        Click Start to launch {CLI_PROVIDERS[cliProvider].name}
      </p>
      {cliProvider === "gemini" && (
        <p className="text-xs mt-1 opacity-70">
          Requires Google account authentication on first use
        </p>
      )}
      {cliProvider === "codex" && (
        <p className="text-xs mt-1 opacity-70">
          Requires OpenRouter API key in Settings
        </p>
      )}
    </>
  )}
</div>
```

**Unit Tests:**
- `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.tsx`
  - Test provider selector renders all options
  - Test model selector only shows for Codex
  - Test disabled state when connected

---

### Task 7: Add OpenRouter API Key to Settings

**Estimated Time:** 2 hours

**Files to modify:**
- `apps/web/src/components/settings/api-keys-settings.tsx` (or create if doesn't exist)

**Files to check for existing settings UI:**
```bash
apps/web/src/components/settings/
apps/web/src/routes/settings.tsx
```

**Implementation:**
Add OpenRouter API key input field following the same pattern as existing API key fields (FAL, Freesound, Gemini).

```tsx
{/* OpenRouter API Key */}
<div className="space-y-2">
  <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
  <div className="flex gap-2">
    <Input
      id="openrouter-key"
      type="password"
      value={openRouterApiKey}
      onChange={(e) => setOpenRouterApiKey(e.target.value)}
      placeholder="sk-or-v1-..."
    />
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
      aria-label={showOpenRouterKey ? "Hide API key" : "Show API key"}
    >
      {showOpenRouterKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  </div>
  <p className="text-xs text-muted-foreground">
    Get your API key from{" "}
    <a
      href="https://openrouter.ai/keys"
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline"
    >
      openrouter.ai/keys
    </a>
  </p>
</div>
```

**Unit Tests:**
- Test API key save/load
- Test masked input display

---

### Task 8: Update Skill Card with Provider Option

**Estimated Time:** 1 hour

**Files to modify:**
- `apps/web/src/components/editor/media-panel/skill-card.tsx`

**Changes:**

Add provider selection to skill card's Run button:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Sparkles, Bot } from "lucide-react";

// Replace single Run button with dropdown
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" variant="default" size="sm" className="flex-1">
      <Play className="h-3 w-3 mr-1" />
      Run
      <ChevronDown className="h-3 w-3 ml-1" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => runSkill(skill.id, "gemini")}>
      <Sparkles className="h-4 w-4 mr-2" />
      Run with Gemini CLI
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => runSkill(skill.id, "codex")}>
      <Bot className="h-4 w-4 mr-2" />
      Run with Codex (OpenRouter)
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Update useSkillRunner hook usage:**
```typescript
const { runSkill } = useSkillRunner();

// Now accepts optional second parameter for provider
const handleRunWithGemini = () => runSkill(skill.id, "gemini");
const handleRunWithCodex = () => runSkill(skill.id, "codex");
```

**Unit Tests:**
- `apps/web/src/components/editor/media-panel/__tests__/skill-card.test.tsx`
  - Test dropdown menu renders both options
  - Test correct provider passed to runSkill

---

## File Path Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/web/src/types/cli-provider.ts` | CLI provider types and configs |
| `apps/web/src/types/__tests__/cli-provider.test.ts` | Unit tests |
| `apps/web/src/stores/__tests__/pty-terminal-store.test.ts` | Store tests |
| `apps/web/src/hooks/__tests__/use-skill-runner.test.ts` | Hook tests |

### Modified Files
| File | Changes |
|------|---------|
| `electron/api-key-handler.ts` | Add openRouterApiKey support |
| `electron/pty-handler.ts` | Add env vars to spawn options |
| `apps/web/src/types/electron.d.ts` | Update ApiKeys type |
| `apps/web/src/stores/pty-terminal-store.ts` | Add cliProvider, selectedModel, update connect() |
| `apps/web/src/hooks/use-skill-runner.ts` | Support provider selection |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Provider/model selectors |
| `apps/web/src/components/editor/media-panel/skill-card.tsx` | Run dropdown with provider options |
| Settings component (TBD) | OpenRouter API key field |

---

## Implementation Order

```
Task 1: Define CLI Provider Types
    ↓
Task 2: Update API Key Handler (depends on types)
    ↓
Task 4: Update PTY Handler (independent, can parallel with Task 2)
    ↓
Task 3: Update PTY Terminal Store (depends on 1, 2, 4)
    ↓
Task 5: Update Skill Runner Hook (depends on 3)
    ↓
Task 6: Update PTY Terminal View UI (depends on 3)
    ↓
Task 7: Add OpenRouter API Key to Settings (depends on 2)
    ↓
Task 8: Update Skill Card (depends on 5)
```

---

## Testing Strategy

### Unit Tests
- Type validations in cli-provider.ts
- Store state transitions and command building
- Hook behavior with different providers
- Component rendering states

### Integration Tests
- Full flow: Set API key → Select provider → Select model → Run skill
- Verify correct command spawned
- Verify environment variables passed

### Manual Testing
- [ ] Install open-codex: `npm install -g open-codex`
- [ ] Configure OpenRouter API key in Settings
- [ ] Select Codex provider in terminal
- [ ] Select a model (e.g., claude-sonnet-4)
- [ ] Run a skill and verify it works
- [ ] Test fallback to Gemini CLI
- [ ] Test shell mode still works

---

## Default Behavior & Fallback

### Default: Gemini CLI
- **New users** start with Gemini CLI (no API key required)
- Gemini CLI uses Google OAuth authentication
- Free tier available with Google account

### Fallback Strategy
If Codex/OpenRouter issues arise:
1. Gemini CLI always available as fallback
2. Can hide Codex option behind feature flag if needed
3. Users can switch back to Gemini at any time

### Provider Selection Persistence
- User's preferred provider is saved in terminal store
- Provider choice persists across sessions
- Default can be changed in Settings (future enhancement)

---

## Long-Term Maintenance

### Both Providers Are Stable
- **Gemini CLI**: Maintained by Google, regular updates
- **open-codex**: Actively maintained community fork
- **OpenRouter**: Stable API, reliable service

### No Translation Layer Needed
- Both CLIs are used as-is (no forking)
- Skills work natively with both (different injection methods)
- Updates to either CLI don't require QCut changes

### Future Enhancements
1. Add more OpenRouter models dynamically via API
2. Add model cost estimation display
3. Add usage tracking per provider
4. Support custom model IDs for OpenRouter
5. Add provider-specific settings (temperature, etc.)
6. Consider adding more providers (e.g., Ollama for local models)

---

## Success Criteria

### Dual Provider Support
1. ✅ **Provider Selection**: Users can choose between Gemini CLI, Codex, or Shell mode
2. ✅ **Gemini CLI Preserved**: Existing Gemini CLI workflow remains fully functional
3. ✅ **Codex Integration**: OpenRouter-powered Codex works with 300+ models
4. ✅ **Skills Work Everywhere**: Skills system works identically with both Gemini and Codex

### Technical Requirements
5. ✅ **API Key Storage**: OpenRouter API key stored securely via Electron
6. ✅ **Model Selection**: Dropdown with 5+ preset models for Codex
7. ✅ **Default Provider**: New users default to Gemini CLI (free, no API key needed)
8. ✅ **Seamless Switching**: Users can switch providers without losing context
9. ✅ **All Tests Pass**: Unit and integration tests for both providers
10. ✅ **Documentation Updated**: Help users understand both options

---

## User Guide: Choosing a Provider

### When to Use Gemini CLI
- ✅ Getting started (no API key needed)
- ✅ Already have a Google account
- ✅ Want free tier access
- ✅ Prefer Google's Gemini models

### When to Use Codex (OpenRouter)
- ✅ Want access to Claude, GPT-4, Llama, etc.
- ✅ Need specific model capabilities
- ✅ Pay-per-use billing preferred
- ✅ Want to compare models on the same task

### Switching Providers
1. Select provider from dropdown in terminal toolbar
2. For Codex: Configure OpenRouter API key in Settings first
3. Select model (Codex only)
4. Click Start to connect

Both providers support all QCut skills identically.

---

## Sources

- [open-codex GitHub](https://github.com/ymichael/open-codex)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [OpenRouter Models](https://openrouter.ai/models)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
