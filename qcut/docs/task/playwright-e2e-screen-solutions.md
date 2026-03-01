# Playwright E2E Test — Visible vs Invisible Mode

QCut E2E tests launch a real Electron window (not headless) because the editor requires full GPU rendering for Canvas, screen recording, Remotion preview, and video decode.

## Running E2E Tests

| Command | Window | Use case |
|---------|--------|----------|
| `bun run test:e2e` | **Visible** | Debugging, watching tests run |
| `bun run test:e2e:bg` | **Invisible** | Background runs, no focus stealing |
| `bun run test:e2e:headed` | **Visible** | Same as default, explicit |
| `bun run test:e2e:ui` | **Playwright UI** | Interactive test explorer |

## How Invisible Mode Works

`bun run test:e2e:bg` sets `QCUT_E2E_OFFSCREEN=1` in the environment. When Electron sees this env var, it makes the window fully transparent (`opacity=0`) and ignores mouse events. The window still renders everything — Playwright can screenshot and interact with it — but it's invisible on all monitors.

**Key files:**
- `scripts/e2e-virtual-display.ts` — Sets `QCUT_E2E_OFFSCREEN=1` and launches Playwright
- `electron/main.ts` — Reads env var, calls `setOpacity(0)` + `setIgnoreMouseEvents(true)`
- `apps/web/src/test/e2e/helpers/electron-helpers.ts` — Forwards `process.env` to `electron.launch()`

**Why not offscreen positioning?** macOS clamps window positions to keep them on-screen, which fails on multi-monitor setups. Transparency works reliably regardless of display configuration.

**Linux CI:** On Linux without a display, `bun run test:e2e:bg` also wraps Playwright with `xvfb-run` if available, creating a virtual X11 framebuffer.

## Passing Arguments

```bash
# Run specific test in invisible mode
bun run test:e2e:bg -- --grep "timeline"

# Run specific test file visibly
bun run test:e2e -- project-workflow
```
