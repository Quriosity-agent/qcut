# AI CLI Integration Evaluation for QCut

This document evaluates three options for integrating an AI coding agent CLI into QCut's terminal system with OpenRouter support.

## Executive Summary

| Criteria | Fork Gemini CLI | Codex (open-codex) | OpenCode |
|----------|-----------------|-------------------|----------|
| **OpenRouter Support** | ⚠️ Requires work | ✅ Native | ✅ Native |
| **Open Source** | ✅ Apache 2.0 | ✅ Apache 2.0 | ✅ MIT |
| **Maintenance Burden** | 🔴 High | 🟢 Low | 🟢 Low |
| **Community Size** | 🟡 Medium | 🟡 Medium | 🟢 Large (70K+ stars) |
| **Skill/Rules Support** | ✅ Native | ⚠️ Via flags | ✅ Native |
| **Terminal UI** | Basic | Basic | ✅ Rich TUI |
| **Recommendation** | ❌ Not recommended | ✅ Good option | ✅ Best option |

---

## Option 1: Fork Gemini CLI

### Overview
Fork Google's official Gemini CLI and modify it to support OpenRouter.

**Repository**: https://github.com/google-gemini/gemini-cli

### Pros
- Already integrated in QCut (familiar codebase)
- Native skill support (context injection works)
- Google's official implementation
- TypeScript/Node.js (matches QCut stack)

### Cons
- **High maintenance burden** - must keep up with upstream changes
- **API incompatibility** - Gemini API format differs from OpenRouter (OpenAI-compatible)
- **Significant refactoring** - need to rewrite API layer for OpenRouter
- **Fork divergence** - will drift from upstream over time
- **No community support** - you're on your own for OpenRouter issues

### Technical Challenges
```
Gemini API Format:
POST /v1beta/models/gemini-pro:generateContent
{ "contents": [{ "parts": [{ "text": "..." }] }] }

OpenRouter Format (OpenAI-compatible):
POST /api/v1/chat/completions
{ "model": "...", "messages": [{ "role": "user", "content": "..." }] }
```

Must implement:
1. Request/response format translation
2. Model name mapping
3. Streaming format conversion
4. Error handling adaptation

### Estimated Effort
- Initial fork & setup: 2-4 hours
- API layer rewrite: 20-40 hours
- Ongoing maintenance: 5-10 hours/month

### Verdict: ❌ Not Recommended
The maintenance burden outweighs benefits. Better to use a tool with native OpenRouter support.

---

## Option 2: Codex CLI (open-codex fork)

### Overview
Use the open-codex fork which has native multi-provider support including OpenRouter.

**Repository**: https://github.com/ymichael/open-codex
**Original**: https://github.com/openai/codex

### Pros
- **Native OpenRouter support** - works out of the box
- **OpenAI backing** - original project by OpenAI
- **Rust-based** - fast and efficient
- **Open source** - Apache 2.0 license
- **Active development** - regular updates
- **Multi-provider** - OpenAI, Gemini, OpenRouter, Ollama

### Cons
- **Skill injection via flags** - less elegant than native support
- **Rust codebase** - harder to modify if needed (QCut is TypeScript)
- **Younger fork** - less battle-tested than original
- **Simpler UI** - basic terminal interface

### Installation
```bash
npm install -g open-codex
# or
cargo install open-codex
```

### Configuration
```bash
export OPENROUTER_API_KEY="sk-or-v1-xxx"
open-codex --provider openrouter --model anthropic/claude-sonnet-4
```

### Skill Integration
```bash
# Pass skill content via message file
open-codex --message-file /path/to/skill.md

# Or via stdin
cat skill.md | open-codex --system-prompt -
```

### Estimated Effort
- Integration: 4-8 hours
- Skill adapter: 2-4 hours
- Ongoing maintenance: 1-2 hours/month

### Verdict: ✅ Good Option
Solid choice with native OpenRouter support. Good if you prefer minimal dependencies.

---

## Option 3: OpenCode

### Overview
Purpose-built open source AI coding agent with rich terminal UI and native OpenRouter support.

**Repository**: https://github.com/opencode-ai/opencode
**Website**: https://opencode.ai

### Pros
- **70K+ GitHub stars** - large, active community
- **Native OpenRouter support** - first-class integration
- **Rich TUI** - beautiful Bubble Tea terminal interface
- **Provider agnostic** - designed for multi-provider from start
- **Built-in agents** - Plan mode (read-only) + Build mode (full access)
- **Session management** - save/restore conversations
- **LSP integration** - code intelligence support
- **File tracking** - visualize changes during sessions
- **Active development** - 500+ contributors, 7000+ commits
- **Multiple install methods** - npm, brew, scoop, curl

### Cons
- **Go codebase** - not TypeScript (but doesn't matter for CLI usage)
- **Larger binary** - more features = bigger size
- **Learning curve** - more features to learn

### Installation
```bash
# npm
npm install -g opencode-ai

# Homebrew (macOS/Linux)
brew install anomalyco/tap/opencode

# Windows (Scoop)
scoop bucket add opencode https://github.com/opencode-ai/scoop-bucket.git
scoop install opencode

# Direct install
curl -fsSL https://opencode.ai/install | bash
```

### Configuration
```bash
# Interactive setup
opencode /connect
# Search for "OpenRouter" and paste API key

# Or via environment
export OPENROUTER_API_KEY="sk-or-v1-xxx"
```

### Skill Integration
OpenCode supports custom instructions similar to Cline's `.clinerules`:

```
.opencode/
├── instructions.md    # Always-active context
└── workflows/         # On-demand skill injection
    ├── video-gen.md
    └── ffmpeg.md
```

Or pass via command:
```bash
opencode --instruction "$(cat skill.md)"
```

### Built-in Agents
- **build** (default): Full access agent for development
- **plan**: Read-only agent for analysis and exploration

Switch with `Tab` key during session.

### Estimated Effort
- Integration: 2-4 hours
- Skill adapter: 2-4 hours
- Ongoing maintenance: ~0 hours (stable, well-maintained)

### Verdict: ✅ Best Option
Most mature, best community support, native OpenRouter, rich features.

---

## Detailed Comparison Matrix

| Feature | Fork Gemini | open-codex | OpenCode |
|---------|-------------|------------|----------|
| **License** | Apache 2.0 | Apache 2.0 | MIT |
| **Language** | TypeScript | Rust | Go |
| **GitHub Stars** | ~5K | ~2K | 70K+ |
| **Contributors** | Google team | Community | 500+ |
| **OpenRouter** | Manual work | Native | Native |
| **300+ Models** | ❌ | ✅ | ✅ |
| **Terminal UI** | Basic | Basic | Rich TUI |
| **Plan/Act Modes** | ❌ | ❌ | ✅ |
| **Session Save** | ❌ | ❌ | ✅ |
| **LSP Support** | ❌ | ❌ | ✅ |
| **File Tracking** | ❌ | ❌ | ✅ |
| **Custom Instructions** | ✅ Native | ⚠️ Flags | ✅ Native |
| **Install Methods** | npm | npm/cargo | npm/brew/scoop/curl |
| **Maintenance** | High | Low | Very Low |

---

## QCut Integration Plan

### Recommended: OpenCode

```typescript
// pty-terminal-store.ts
type CliMode = "gemini" | "opencode" | "custom";

const CLI_COMMANDS: Record<CliMode, string> = {
  gemini: "npx @google/gemini-cli@latest",
  opencode: "opencode",
  custom: "", // User-defined
};

interface PtyTerminalState {
  // ... existing fields
  cliMode: CliMode;
  openRouterApiKey: string | null;
}
```

### Skill Integration with OpenCode

```typescript
// use-skill-runner.ts
async function runSkill(skillId: string) {
  const skill = skills.find(s => s.id === skillId);

  if (cliMode === "opencode") {
    // OpenCode supports instruction flag
    const command = `opencode --instruction "${escapeQuotes(skill.content)}"`;
    await connect({ command });
  } else if (cliMode === "gemini") {
    // Existing Gemini flow with skill prompt injection
    setActiveSkill({ id, name, content });
    await connect();
  }
}
```

### UI Changes Needed

1. **Settings panel**: Add CLI mode selector (Gemini / OpenCode / Custom)
2. **API key management**: Store OpenRouter key securely
3. **Model selector**: List available OpenRouter models
4. **Skill runner**: Adapt for different CLI tools

---

## Migration Path

### Phase 1: Add OpenCode Support (Week 1)
- Add CLI mode toggle in settings
- Implement OpenCode command spawning
- Test skill injection via `--instruction` flag

### Phase 2: OpenRouter Integration (Week 2)
- Add OpenRouter API key storage (Electron secure storage)
- Add model selector dropdown
- Implement `/models` command integration

### Phase 3: Deprecate Gemini-Only (Week 3-4)
- Default to OpenCode for new users
- Keep Gemini CLI as legacy option
- Document migration for existing users

---

## Final Recommendation

**Use OpenCode** for these reasons:

1. **Largest community** (70K+ stars) = long-term stability
2. **Native OpenRouter** = no maintenance burden
3. **Rich TUI** = better user experience
4. **Plan/Build modes** = matches QCut's skill concept
5. **Provider agnostic** = future-proof
6. **Active development** = continuous improvements

The fork approach (Option 1) would require significant ongoing effort with little benefit. OpenCode gives you everything needed with zero maintenance overhead.

---

## Sources

- [OpenCode GitHub](https://github.com/opencode-ai/opencode)
- [OpenCode Documentation](https://opencode.ai/docs/)
- [open-codex GitHub](https://github.com/ymichael/open-codex)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [Kickstart OpenCode with OpenRouter](https://dev.to/mozes721/kickstart-opencode-with-openrouter-32o7)
