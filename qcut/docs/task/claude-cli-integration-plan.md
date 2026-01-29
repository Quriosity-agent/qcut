# Claude CLI Integration Plan

**Feature:** Add Claude Code CLI as a third AI coding agent provider
**Branch:** `feature/claude-cli-provider`
**Priority:** High
**Estimated Effort:** Medium (6 subtasks, ~8-10 hours total)

---

## Overview

QCut currently supports **Gemini CLI** and **Codex (OpenRouter)** as AI coding agents. This plan adds **Claude Code CLI** as a third option, giving users direct access to Anthropic's Claude models without going through OpenRouter.

| Provider | Models | Authentication | Best For |
|----------|--------|----------------|----------|
| **Gemini CLI** | Gemini Pro, Flash | Google OAuth | Free tier, Google users |
| **Codex (OpenRouter)** | 300+ models | API Key | Model flexibility, pay-per-use |
| **Claude Code CLI** | Claude Sonnet, Opus, Haiku | Anthropic API Key | Direct Anthropic access, best Claude performance |

### Why Add Claude CLI?

1. **Direct Anthropic access** - No middleman, potentially better performance
2. **Native Claude experience** - Same CLI used by Claude Code users
3. **Model aliases** - Simple `sonnet`, `opus`, `haiku` instead of full model names
4. **Permission modes** - Built-in approval controls that match QCut's philosophy
5. **User demand** - Claude is the most requested model for coding tasks

---

## Current State Analysis

### Existing Architecture

| Component | File Path | Purpose |
|-----------|-----------|---------|
| CLI Provider Types | `apps/web/src/types/cli-provider.ts` | Provider definitions and configs |
| PTY Terminal Store | `apps/web/src/stores/pty-terminal-store.ts` | Terminal state, command building |
| Skill Runner Hook | `apps/web/src/hooks/use-skill-runner.ts` | Runs skills with providers |
| PTY Terminal View | `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | UI with provider selector |
| API Key Handler | `electron/api-key-handler.ts` | Secure API key storage |
| PTY Handler | `electron/pty-handler.ts` | Spawns PTY sessions |

### Current Provider Type

```typescript
export type CliProvider = "gemini" | "codex" | "shell";
```

---

## Claude CLI Reference

### Command & Installation

```bash
# Claude CLI is installed globally (not via npx)
# Users must have it pre-installed
claude --version
```

### Key Flags for QCut Integration

| Flag | Purpose | QCut Usage |
|------|---------|------------|
| `--model` | Select model (sonnet, opus, haiku) | Model selector dropdown |
| `--append-system-prompt` | Add custom system prompt | Skill injection |
| `--permission-mode` | Set approval mode | Match QCut UX |
| `--dangerously-skip-permissions` | Full auto mode | Optional advanced toggle |
| `--print` | Non-interactive mode | For scripted operations |

### Model Aliases

| Alias | Full Name | Best For |
|-------|-----------|----------|
| `sonnet` | claude-sonnet-4-5-20250929 | Balanced quality/cost |
| `opus` | claude-opus-4-5-20251101 | Maximum quality |
| `haiku` | claude-haiku-4-5-20251001 | Fast, cheap |

### Skill Injection

Claude CLI supports system prompt append:

```bash
claude --model sonnet --append-system-prompt "$(cat skill.md)"
```

Or via file (print mode only):

```bash
claude --model sonnet --append-system-prompt-file skill.md --print "task"
```

---

## Implementation Tasks

### Task 1: Update CLI Provider Types

**Estimated Time:** 30 minutes

**File:** `apps/web/src/types/cli-provider.ts`

**Changes:**

1. Add `"claude"` to `CliProvider` type
2. Add Claude provider config to `CLI_PROVIDERS`
3. Add Claude model definitions

```typescript
// Update type
export type CliProvider = "gemini" | "codex" | "claude" | "shell";

// Add to CLI_PROVIDERS
claude: {
  id: "claude",
  name: "Claude Code",
  description: "Anthropic's Claude AI assistant (requires claude CLI)",
  command: "claude",
  requiresApiKey: true,
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  supportsSkillFlag: true,
  skillFlagFormat: "--append-system-prompt",
},

// Add Claude models
export const CLAUDE_MODELS: ClaudeModel[] = [
  {
    id: "sonnet",
    name: "Claude Sonnet 4",
    description: "Balanced quality and speed",
    contextLength: 200000,
  },
  {
    id: "opus",
    name: "Claude Opus 4.5",
    description: "Maximum quality",
    contextLength: 200000,
  },
  {
    id: "haiku",
    name: "Claude Haiku 4",
    description: "Fast and efficient",
    contextLength: 200000,
  },
];
```

**Unit Tests:** `apps/web/src/types/__tests__/cli-provider.test.ts`
- Verify Claude provider exists in CLI_PROVIDERS
- Verify CLAUDE_MODELS structure

---

### Task 2: Update API Key Handler

**Estimated Time:** 45 minutes

**File:** `electron/api-key-handler.ts`

**Changes:**

Add `anthropicApiKey` to the ApiKeys interface and handle encryption/decryption:

```typescript
interface ApiKeys {
  falApiKey: string;
  freesoundApiKey: string;
  geminiApiKey: string;
  openRouterApiKey: string;
  anthropicApiKey: string; // NEW
}
```

**Also update:** `apps/web/src/types/electron.d.ts`

**Unit Tests:** `electron/__tests__/api-key-handler.test.ts`
- Test Anthropic key encryption/decryption
- Test backward compatibility

---

### Task 3: Update PTY Terminal Store

**Estimated Time:** 1.5 hours

**File:** `apps/web/src/stores/pty-terminal-store.ts`

**Changes:**

1. Add Claude model state:
```typescript
interface PtyTerminalState {
  // ... existing
  selectedClaudeModel: string | null; // For Claude model selection
}
```

2. Update `connect()` to handle Claude provider:
```typescript
if (cliProvider === "claude") {
  // Get Anthropic API key
  const apiKeys = await window.electronAPI?.apiKeys?.get();
  if (!apiKeys?.anthropicApiKey) {
    set({
      status: "error",
      error: "Anthropic API key not configured. Go to Settings > API Keys.",
    });
    return;
  }

  env.ANTHROPIC_API_KEY = apiKeys.anthropicApiKey;

  // Build Claude command
  command = `claude`;
  if (selectedClaudeModel) {
    command += ` --model ${selectedClaudeModel}`;
  }

  // Inject skill via --append-system-prompt if active
  if (activeSkill?.content) {
    const escapedContent = activeSkill.content.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    command += ` --append-system-prompt "${escapedContent}"`;
  }
}
```

3. Add action for Claude model selection:
```typescript
setSelectedClaudeModel: (modelId: string | null) => {
  set({ selectedClaudeModel: modelId });
},
```

**Unit Tests:** `apps/web/src/stores/__tests__/pty-terminal-store.test.ts`
- Test Claude command building
- Test API key requirement check
- Test skill injection via --append-system-prompt

---

### Task 4: Update PTY Terminal View UI

**Estimated Time:** 1.5 hours

**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

**Changes:**

1. Import Claude models and add icon:
```typescript
import { CLAUDE_MODELS } from "@/types/cli-provider";
import { Sparkles, Bot, Terminal as TerminalIcon, MessageSquare } from "lucide-react";
// MessageSquare for Claude
```

2. Add Claude to provider selector:
```tsx
{provider.id === "claude" && <MessageSquare className="h-3 w-3" />}
```

3. Add Claude model selector (similar to Codex model selector):
```tsx
{cliProvider === "claude" && (
  <Select
    value={selectedClaudeModel || ""}
    onValueChange={setSelectedClaudeModel}
    disabled={isConnected || isConnecting}
  >
    <SelectTrigger className="w-[140px] h-8" aria-label="Select Claude model">
      <SelectValue placeholder="Select model" />
    </SelectTrigger>
    <SelectContent>
      {CLAUDE_MODELS.map((model) => (
        <SelectItem key={model.id} value={model.id}>
          <div className="flex flex-col">
            <span>{model.name}</span>
            <span className="text-xs text-muted-foreground">{model.description}</span>
          </div>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

4. Update placeholder text for Claude:
```tsx
{cliProvider === "claude" && (
  <p className="text-xs mt-1 opacity-70">
    Requires Anthropic API key and claude CLI installed
  </p>
)}
```

**Unit Tests:** `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.tsx`
- Test Claude appears in provider dropdown
- Test Claude model selector only shows for Claude provider

---

### Task 5: Add Anthropic API Key to Settings

**Estimated Time:** 1 hour

**File:** `apps/web/src/components/editor/properties-panel/settings-view.tsx`

**Changes:**

Add Anthropic API key field following existing pattern:

```tsx
{/* Anthropic API Key */}
<div className="space-y-2">
  <Label htmlFor="anthropic-key">Anthropic API Key</Label>
  <div className="flex gap-2">
    <Input
      id="anthropic-key"
      type={showAnthropicKey ? "text" : "password"}
      value={anthropicApiKey}
      onChange={(e) => setAnthropicApiKey(e.target.value)}
      placeholder="sk-ant-..."
    />
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
      aria-label={showAnthropicKey ? "Hide API key" : "Show API key"}
    >
      {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  </div>
  <p className="text-xs text-muted-foreground">
    Get your API key from{" "}
    <a
      href="https://console.anthropic.com/settings/keys"
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline"
    >
      console.anthropic.com
    </a>
  </p>
</div>
```

**Unit Tests:**
- Test API key save/load for Anthropic
- Test masked input display

---

### Task 6: Update Skill Card with Claude Option

**Estimated Time:** 30 minutes

**File:** `apps/web/src/components/editor/media-panel/skill-card.tsx`

**Changes:**

Add Claude to the Run dropdown:

```tsx
<DropdownMenuItem onClick={() => runSkill(skill.id, "claude")}>
  <MessageSquare className="h-4 w-4 mr-2" />
  Run with Claude Code
</DropdownMenuItem>
```

**Unit Tests:** `apps/web/src/components/editor/media-panel/__tests__/skill-card.test.tsx`
- Test Claude option appears in dropdown
- Test correct provider passed to runSkill

---

## File Path Summary

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/types/cli-provider.ts` | Add Claude provider and models |
| `apps/web/src/types/electron.d.ts` | Add anthropicApiKey to ApiKeys |
| `electron/api-key-handler.ts` | Add Anthropic key handling |
| `apps/web/src/stores/pty-terminal-store.ts` | Add Claude command building |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Add Claude UI |
| `apps/web/src/components/editor/properties-panel/settings-view.tsx` | Add Anthropic API key field |
| `apps/web/src/components/editor/media-panel/skill-card.tsx` | Add Claude to Run dropdown |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/src/types/__tests__/cli-provider.test.ts` | Claude provider config |
| `apps/web/src/stores/__tests__/pty-terminal-store.test.ts` | Claude command building |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.ts` | Claude UI elements |

---

## Implementation Order

```
Task 1: Update CLI Provider Types
    ↓
Task 2: Update API Key Handler
    ↓
Task 3: Update PTY Terminal Store (depends on 1, 2)
    ↓
Task 4: Update PTY Terminal View UI (depends on 1, 3)
    ↓
Task 5: Add Anthropic API Key to Settings (depends on 2)
    ↓
Task 6: Update Skill Card (depends on 1)
```

---

## Testing Strategy

### Unit Tests
- Type validations for Claude provider
- API key encryption/decryption
- Command building logic
- UI component rendering

### Manual Testing Checklist
- [ ] Install claude CLI: Verify user has `claude` command available
- [ ] Configure Anthropic API key in Settings
- [ ] Select Claude provider in terminal
- [ ] Select model (sonnet, opus, haiku)
- [ ] Start Claude session without skill
- [ ] Run a skill with Claude provider
- [ ] Verify skill content is injected via --append-system-prompt
- [ ] Test model switching
- [ ] Test error handling when API key missing
- [ ] Test error handling when claude CLI not installed

---

## User Guide

### Prerequisites

1. **Install Claude Code CLI**:
   - Download from [Claude Code](https://claude.ai/download)
   - Or use Anthropic's installation instructions

2. **Get Anthropic API Key**:
   - Go to [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - Create a new API key

### Configuration in QCut

1. Open **Settings > API Keys**
2. Enter your Anthropic API key
3. In the terminal, select **Claude Code** from the provider dropdown
4. Select your preferred model (Sonnet recommended for balance)
5. Click **Start** to launch Claude

### Running Skills with Claude

1. Go to **Skills** tab
2. Click the dropdown arrow on any skill's **Run** button
3. Select **Run with Claude Code**
4. Claude will start with the skill's instructions pre-loaded

---

## Cost Comparison

| Provider | Model | Input (1K tokens) | Output (1K tokens) |
|----------|-------|-------------------|-------------------|
| Gemini CLI | Gemini Flash | Free tier | Free tier |
| Codex (OpenRouter) | Claude Sonnet 4 | $0.003 | $0.015 |
| Codex (OpenRouter) | DeepSeek | $0.00014 | $0.00028 |
| **Claude Code** | **Sonnet** | **$0.003** | **$0.015** |
| **Claude Code** | **Opus** | **$0.015** | **$0.075** |
| **Claude Code** | **Haiku** | **$0.00025** | **$0.00125** |

**Note:** Claude Code direct pricing may differ from OpenRouter. Check Anthropic's pricing page for current rates.

---

## Success Criteria

1. ✅ Claude appears as provider option in terminal
2. ✅ Model selector shows Sonnet, Opus, Haiku when Claude selected
3. ✅ Anthropic API key can be configured in Settings
4. ✅ Claude command builds correctly with model and skill flags
5. ✅ Skills can be run with Claude provider
6. ✅ Error handling for missing API key
7. ✅ Error handling for missing claude CLI
8. ✅ All existing tests still pass
9. ✅ New unit tests for Claude functionality

---

## Long-Term Maintenance

### Update Considerations
- **Model aliases**: Anthropic may add new model aliases - easy to update in CLAUDE_MODELS
- **CLI flags**: Monitor Claude Code releases for flag changes
- **API changes**: Anthropic API is stable; key format unlikely to change

### Backward Compatibility
- Existing Gemini and Codex configurations remain unchanged
- Users can continue using existing providers
- Claude is purely additive

---

## References

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Anthropic API Console](https://console.anthropic.com/)
- [Claude Code GitHub](https://github.com/anthropics/claude-code)
- [QCut Dual CLI Provider Plan](./codex-cli-integration-plan.md)
