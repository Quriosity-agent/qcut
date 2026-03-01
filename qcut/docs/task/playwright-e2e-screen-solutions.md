# Playwright E2E Test Screen Occupation — Solutions

Playwright E2E tests pop up browser windows that occupy the screen. Here are several solutions from lightweight to heavy:

## 1. Headless Mode (Simplest — Recommended to Try First)

```
npx playwright test --headed  # ← what you're currently using, pops up windows
npx playwright test           # ← default headless, no windows
```

Playwright defaults to headless mode and won't occupy the screen. If your config has `headless: false`, change it to `true` or remove it.

## 2. Virtual Desktop (Built into Windows, Zero Cost)

- `Win + Ctrl + D` to create a new virtual desktop
- Run Playwright on the second desktop while you work on the first
- `Win + Ctrl + Left/Right` to switch between desktops

## 3. WSL + Xvfb (Linux Virtual Display)

Run Playwright inside WSL using `xvfb-run` to create a virtual screen:

```bash
# Install
sudo apt install xvfb

# Run (virtual 1920x1080 screen)
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" npx playwright test
```

No windows will appear on your real screen.

## 4. Docker Container (Full Isolation)

```bash
# Playwright official Docker image
docker run --rm -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.58.0-jammy \
  npx playwright test
```

Fully isolated, no impact on the host machine.

## 5. Automatic Virtual Display System (Cross-Platform — Recommended)

QCut requires full GUI rendering (Canvas, screen recording, Remotion preview, video decode), so headless mode is insufficient.

We designed a cross-platform virtual display system — a single script that automatically detects the platform and selects the best strategy:

- **Windows**: Virtual Desktop API — runs Electron on a new virtual desktop without affecting the user's desktop
- **macOS**: CGVirtualDisplay (macOS 14+) — creates a virtual monitor, or falls back to offscreen window positioning
- **Linux/CI**: xvfb-run — standard CI approach using a virtual X11 framebuffer

```bash
# Run E2E tests in a virtual display (no focus stealing)
bun run test:e2e:bg

# Pass arguments to Playwright
bun run test:e2e:bg -- --grep "timeline"
```

See detailed implementation plan → [E2E Virtual Display Plan](./e2e-virtual-display-plan.md)

## Recommendations

- **During development**: Option 5 (virtual display) or Option 2 (manually switch virtual desktops)
- **CI/CD**: Option 5 (automatic virtual display, cross-platform)
- **Need to see the UI for debugging**: Option 2 (virtual desktop)
- **Don't want any interruption**: Option 5 (virtual display) or Option 3 (Xvfb) or Option 4 (Docker)
