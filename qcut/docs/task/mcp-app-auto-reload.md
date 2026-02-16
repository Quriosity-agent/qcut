# MCP App Auto-Reload

## Problem

When the MCP media app template (`MCP_MEDIA_APP_TEMPLATE`) is updated in source code, the running preview panel does not reflect the change. Users must manually click "Return to Preview" then "MCP Media App" to see the new UI.

### Root Cause

The toggle flow stores a **snapshot** of the built HTML string in Zustand:

```text
User clicks "MCP Media App"
  → toggleMcpMediaApp()
  → buildMcpMediaAppHtml() builds HTML string from template
  → setMcpApp({ html, toolName }) writes snapshot into useMcpAppStore
  → iframe renders srcDoc={activeHtml} from store
```

The store holds the old HTML indefinitely. HMR replaces the module-level `MCP_MEDIA_APP_TEMPLATE` constant, but the Zustand store retains the stale snapshot. The iframe never re-renders with the new template.

### Affected Files

- `apps/web/src/components/editor/preview-panel.tsx` — template + toggle logic
- `apps/web/src/stores/mcp-app-store.ts` — Zustand store

## Proposed Approaches

### Approach A: Derive local HTML at render time (Recommended)

Stop storing local MCP HTML in the Zustand store. Instead, only store a boolean flag. Build the HTML fresh from the template on each render.

**Store change** (`mcp-app-store.ts`):

```ts
interface McpAppState {
  activeHtml: string | null;   // only for external MCP apps
  toolName: string | null;     // only for external MCP apps
  localMcpActive: boolean;     // new: tracks local toggle state
}
```

**Render logic** (`preview-panel.tsx`):

```tsx
const localMcpActive = useMcpAppStore((s) => s.localMcpActive);
const externalHtml = useMcpAppStore((s) => s.activeHtml);

// Local MCP: always rebuild from current template
// External MCP: use stored HTML from IPC
const displayHtml = localMcpActive
  ? buildMcpMediaAppHtml({ projectId: activeProject?.id ?? null })
  : externalHtml;
```

**Pros**:
- Simplest change, minimal code
- Local MCP always renders the latest template — HMR works instantly
- External MCP apps (from IPC / HTTP) are unaffected
- No stale state possible for local MCP

**Cons**:
- `buildMcpMediaAppHtml` runs on every render when local MCP is active (cheap — just a string replace)

### Approach B: Version key invalidation

Add a version constant next to the template. When the component mounts or the version changes, compare and rebuild.

```ts
const MCP_TEMPLATE_VERSION = "2";
const MCP_MEDIA_APP_TEMPLATE = `...`;
```

Store tracks `{ activeHtml, toolName, templateVersion }`. A `useEffect` compares `templateVersion` with `MCP_TEMPLATE_VERSION` and calls `setMcpApp()` if they differ.

**Pros**:
- Explicit versioning — clear when updates happen
- Store still holds cached HTML (useful if building is expensive)

**Cons**:
- Must manually bump version on every template change
- More moving parts (extra state, extra effect)
- Easy to forget the version bump

### Approach C: Content hash comparison

Compute a simple hash of the template string. In a `useEffect`, compare the hash of the current `activeHtml` with the hash of the freshly built HTML. If different and the active tool is the local MCP, update the store.

**Pros**:
- Fully automatic — no manual version bumps
- Works for any template change

**Cons**:
- Hashing on every render/effect cycle is wasteful
- Over-engineered for a string replace operation
- More complex than Approach A

## Recommendation

**Approach A** is the clear winner. It eliminates the stale-state problem entirely for local MCP by not caching the HTML in the first place. The build cost is trivial (one `String.replace` call), and external MCP apps remain unaffected.

## Implementation Scope

1. `mcp-app-store.ts` — add `localMcpActive` boolean + `toggleLocalMcp` / `clearLocalMcp` actions
2. `preview-panel.tsx` — derive `displayHtml` at render time instead of reading `activeHtml` for local MCP
3. Toggle button calls `toggleLocalMcp()` instead of `setMcpApp()` for local MCP
4. External MCP path (IPC `onAppHtml`) continues using `setMcpApp()` unchanged
