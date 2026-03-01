# E2E Virtual Display System — Implementation Plan

Cross-platform virtual display system for running QCut Electron E2E tests with full GUI rendering without stealing the user's mouse/keyboard focus.

## Why Not Headless?

QCut requires full GPU-accelerated rendering for:
- HTML5 Canvas compositing (timeline, waveforms)
- Screen recording via MediaRecorder
- Remotion preview (React video rendering)
- Hardware video decode (Electron media pipeline)

Headless Chromium/Electron disables or stubs these APIs, causing test failures.

## Architecture

```
scripts/e2e-virtual-display.ts    ← Single entry point
├── detectPlatform()              ← Returns "windows" | "macos" | "linux"
├── WindowsVirtualDesktop         ← Win32 Virtual Desktop API
├── MacOSVirtualDisplay           ← CGVirtualDisplay or offscreen fallback
├── LinuxXvfb                     ← xvfb-run + optional VirtualGL
└── launchPlaywright(env)         ← Spawns `playwright test` with display env
```

### Entry point: `scripts/e2e-virtual-display.ts`

```ts
import { spawn } from "node:child_process";
import { platform } from "node:os";

async function main() {
  const plat = platform(); // "win32" | "darwin" | "linux"
  const strategy = createStrategy(plat);

  let env: Record<string, string> = {};
  try {
    env = await strategy.setup();
    const exitCode = await runPlaywright(env, process.argv.slice(2));
    process.exit(exitCode);
  } catch (err) {
    console.error(`Virtual display setup failed, falling back to direct launch`);
    const exitCode = await runPlaywright({}, process.argv.slice(2));
    process.exit(exitCode);
  } finally {
    await strategy.teardown();
  }
}
```

Each platform strategy implements:

```ts
interface VirtualDisplayStrategy {
  setup(): Promise<Record<string, string>>;   // Returns env vars for Playwright
  teardown(): Promise<void>;                   // Cleanup, even on crash
}
```

---

## Platform 1: Windows — Virtual Desktop API

### Strategy

Create a new Win32 Virtual Desktop, launch Electron there, run tests, destroy the desktop. The user stays on their current desktop undisturbed.

### API

Windows 10/11 expose the `IVirtualDesktopManager` and undocumented `IVirtualDesktopManagerInternal` COM interfaces. Since these are COM interfaces without stable public headers, we use PowerShell to orchestrate:

### Implementation

```
scripts/
  e2e-virtual-display.ts              ← Main script
  e2e-virtual-display-win.ps1         ← PowerShell helper for Virtual Desktop
```

**PowerShell helper** (`e2e-virtual-display-win.ps1`):

```powershell
# Uses VirtualDesktop PowerShell module (or raw COM interop)
# 1. Create new virtual desktop
# 2. Switch Electron window to that desktop after launch
# 3. On exit: remove the desktop, windows return to original

param(
    [Parameter(Mandatory=$true)]
    [string]$Action  # "create" | "move-window" | "cleanup"
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown),
 Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
public interface IVirtualDesktopManager {
    bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
    Guid GetWindowDesktopId(IntPtr topLevelWindow);
    void MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
}
"@

switch ($Action) {
    "create" {
        # Create desktop, output its GUID to stdout
        # Uses IVirtualDesktopManagerInternal::CreateDesktop
    }
    "move-window" {
        # Move hwnd (passed as -Hwnd param) to target desktop GUID
    }
    "cleanup" {
        # Remove the virtual desktop by GUID, windows migrate back
    }
}
```

**TypeScript orchestration**:

```ts
class WindowsVirtualDesktop implements VirtualDisplayStrategy {
  private desktopId: string | null = null;

  async setup(): Promise<Record<string, string>> {
    // 1. Run PowerShell to create virtual desktop, capture GUID
    const result = await execPS("scripts/e2e-virtual-display-win.ps1", ["-Action", "create"]);
    this.desktopId = result.stdout.trim();

    // 2. Set env var so Electron test harness knows to signal back its HWND
    return {
      QCUT_E2E_VIRTUAL_DESKTOP: this.desktopId,
      QCUT_E2E_MOVE_WINDOW: "1",
    };
  }

  async teardown(): Promise<void> {
    if (!this.desktopId) return;
    await execPS("scripts/e2e-virtual-display-win.ps1", [
      "-Action", "cleanup",
      "-DesktopId", this.desktopId,
    ]);
  }
}
```

**Window movement flow**:
1. Script creates virtual desktop, gets GUID
2. Playwright launches Electron with `QCUT_E2E_VIRTUAL_DESKTOP` env var
3. After Electron's `BrowserWindow` emits `ready-to-show`, E2E test fixture calls PowerShell to move the HWND to the virtual desktop
4. Tests run on the hidden desktop
5. Teardown destroys the desktop; any remaining windows return to the user's desktop

### Dependencies

- PowerShell 5.1+ (ships with Windows 10/11)
- No external packages required
- Optional: `VirtualDesktop` PowerShell module from PSGallery for simpler API

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `IVirtualDesktopManagerInternal` is undocumented, GUIDs change across Windows builds | Medium | Pin known GUIDs per build range; fall back to `-2000,-2000` window positioning |
| Desktop not cleaned up on crash | Low | Register `process.on('exit')` + `process.on('SIGINT')` + PowerShell trap |
| Electron window briefly visible before move | Low | Create window offscreen initially (`x: -2000`), then move to virtual desktop |

### Fallback

If PowerShell COM interop fails (e.g., Windows Server without desktop experience), fall back to launching Electron with `--window-position=-2000,-2000`. The window renders fully but is offscreen.

---

## Platform 2: macOS — CGVirtualDisplay

### Strategy

On macOS 14+ (Sonoma), use the `CGVirtualDisplay` API to create a virtual monitor that doesn't correspond to any physical display. Electron renders to it at full fidelity. If unavailable, fall back to offscreen window positioning.

### Implementation

```
scripts/
  e2e-virtual-display.ts
  e2e-virtual-display-mac.swift       ← Swift helper compiled at first run
```

**Swift helper** (`e2e-virtual-display-mac.swift`):

```swift
import CoreGraphics
import Foundation

// CGVirtualDisplay is available macOS 14.0+
if #available(macOS 14.0, *) {
    let descriptor = CGVirtualDisplayDescriptor()
    descriptor.setWidth(1920)
    descriptor.setHeight(1080)
    descriptor.setPixelsPerInch(144)

    let display = CGVirtualDisplay(descriptor: descriptor)

    // Output the CGDirectDisplayID for DISPLAY targeting
    let displayID = display.displayID
    print("DISPLAY_ID=\(displayID)")

    // Keep alive until stdin closes (parent process controls lifetime)
    FileHandle.standardInput.readDataToEndOfFile()

    // Implicit cleanup: display deallocated when process exits
} else {
    print("FALLBACK")
    exit(0)
}
```

**TypeScript orchestration**:

```ts
class MacOSVirtualDisplay implements VirtualDisplayStrategy {
  private helperProcess: ChildProcess | null = null;
  private compiledPath: string | null = null;

  async setup(): Promise<Record<string, string>> {
    // 1. Compile Swift helper if needed (cached)
    const swiftSrc = resolve(__dirname, "e2e-virtual-display-mac.swift");
    this.compiledPath = resolve(__dirname, "../.cache/e2e-vdisplay");
    await exec(`swiftc -O ${swiftSrc} -o ${this.compiledPath}`);

    // 2. Launch helper, read display ID from stdout
    this.helperProcess = spawn(this.compiledPath);
    const displayId = await readLine(this.helperProcess.stdout!);

    if (displayId === "FALLBACK") {
      return { QCUT_E2E_OFFSCREEN: "1" }; // Fallback: window at -2000,-2000
    }

    // 3. Target Electron to this virtual display
    return {
      QCUT_E2E_DISPLAY_ID: displayId.replace("DISPLAY_ID=", ""),
    };
  }

  async teardown(): Promise<void> {
    // Close stdin → Swift process exits → CGVirtualDisplay deallocated
    this.helperProcess?.stdin?.end();
    this.helperProcess?.kill();
  }
}
```

**How Electron targets the virtual display**:
- Use `screen.getAllDisplays()` in the Electron main process to find the virtual display by ID
- Position the `BrowserWindow` on that display's bounds
- Alternatively, launch with `--screen=N` or set `x`/`y` to the virtual display's origin

### Dependencies

- macOS 14+ (Sonoma) for `CGVirtualDisplay`
- Xcode Command Line Tools (for `swiftc`)
- No external packages

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| macOS < 14 has no `CGVirtualDisplay` | Medium | Fallback to `-2000,-2000` positioning — still renders fully, just offscreen |
| `swiftc` not installed | Low | Check and prompt user to install Xcode CLI tools |
| Apple may change/restrict API | Low | API is public in CoreGraphics; monitor release notes |

### Fallback

If `CGVirtualDisplay` is unavailable (macOS < 14) or `swiftc` fails:
- Launch Electron with window position `(-2000, -2000)`
- Full rendering still occurs; window is simply offscreen
- Mouse/keyboard not stolen since the window isn't on any visible display

---

## Platform 3: Linux/CI — Xvfb

### Strategy

Use `xvfb-run` to create a virtual X11 framebuffer. This is the standard CI approach and works perfectly for headless Linux servers and GitHub Actions.

### Implementation

```ts
class LinuxXvfb implements VirtualDisplayStrategy {
  private serverNum: number | null = null;

  async setup(): Promise<Record<string, string>> {
    // Check if xvfb-run is available
    const hasXvfb = await commandExists("xvfb-run");

    if (!hasXvfb) {
      // Check if we already have a display (desktop Linux)
      if (process.env.DISPLAY) {
        console.log(`Using existing DISPLAY=${process.env.DISPLAY}`);
        return {};
      }
      throw new Error("No display available and xvfb-run not found");
    }

    // Find free server number
    this.serverNum = await findFreeServerNum();

    // Note: xvfb-run wraps the command, so we return env vars
    // and the launcher will use xvfb-run as prefix
    return {
      QCUT_E2E_USE_XVFB: "1",
      QCUT_E2E_XVFB_SERVER: String(this.serverNum),
      DISPLAY: `:${this.serverNum}`,
    };
  }

  async teardown(): Promise<void> {
    // xvfb-run handles its own cleanup when child exits
    // But if we started Xvfb manually, kill it
    if (this.serverNum) {
      await exec(`kill $(cat /tmp/.X${this.serverNum}-lock) 2>/dev/null || true`);
    }
  }
}
```

**Playwright launch with Xvfb**:

When `QCUT_E2E_USE_XVFB=1`, the launcher wraps the command:

```ts
async function runPlaywright(env: Record<string, string>, args: string[]): Promise<number> {
  const useXvfb = env.QCUT_E2E_USE_XVFB === "1";

  const command = useXvfb
    ? "xvfb-run"
    : "bunx";

  const commandArgs = useXvfb
    ? [
        "--auto-servernum",
        "--server-args=-screen 0 1920x1080x24 -ac",
        "bunx", "playwright", "test", ...args,
      ]
    : ["playwright", "test", ...args];

  return spawnAndWait(command, commandArgs, {
    ...process.env,
    ...env,
  });
}
```

### Optional: VirtualGL for GPU acceleration

```bash
# If VirtualGL is installed, use it for hardware-accelerated rendering
# inside Xvfb (useful for WebGL-heavy tests)
VGL_DISPLAY=:0 vglrun xvfb-run --auto-servernum \
  --server-args="-screen 0 1920x1080x24" \
  bunx playwright test
```

### Dependencies

| Package | Required | Install |
|---------|----------|---------|
| `xvfb` | Yes (CI) | `apt install xvfb` |
| `virtualgl` | Optional | `apt install virtualgl` (for GPU accel) |
| `mesa-utils` | Optional | For `glxinfo` verification |

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Xvfb not installed on desktop Linux | Low | Fallback to existing `$DISPLAY`; user's desktop is used |
| No GPU accel in Xvfb by default | Low | VirtualGL optional; software rendering sufficient for tests |
| Wayland-only system (no X11) | Medium | Use `weston-launch` with virtual output, or `wlheadless-run` |

### Fallback

If `xvfb-run` is not available:
1. Use existing `$DISPLAY` if set (desktop Linux — tests will be visible)
2. If no display at all, error with install instructions

---

## Platform Detection

```ts
function createStrategy(plat: NodeJS.Platform): VirtualDisplayStrategy {
  switch (plat) {
    case "win32":
      return new WindowsVirtualDesktop();
    case "darwin":
      return new MacOSVirtualDisplay();
    case "linux":
      return new LinuxXvfb();
    default:
      // Unknown platform: try direct launch
      return new NoOpStrategy();
  }
}
```

The `NoOpStrategy` returns empty env and does nothing on teardown — Playwright launches directly.

---

## Playwright Integration

### How tests launch Electron in the virtual display

The E2E test fixtures already launch Electron via `electron.launch()`. The virtual display script sets environment variables that the Electron main process reads:

```ts
// In electron/main.ts — E2E virtual display support
if (process.env.QCUT_E2E_VIRTUAL_DESKTOP) {
  // Windows: window will be moved to virtual desktop by test fixture
  mainWindow.setPosition(-2000, -2000); // Start offscreen until moved
}

if (process.env.QCUT_E2E_DISPLAY_ID) {
  // macOS: position window on virtual display
  const displays = screen.getAllDisplays();
  const target = displays.find(d =>
    String(d.id) === process.env.QCUT_E2E_DISPLAY_ID
  );
  if (target) {
    mainWindow.setBounds(target.bounds);
  }
}

if (process.env.QCUT_E2E_OFFSCREEN) {
  // Fallback: offscreen position
  mainWindow.setPosition(-2000, -2000);
}
```

On Linux, no Electron code changes needed — `DISPLAY` env var is inherited and Electron renders to the Xvfb framebuffer automatically.

---

## Cleanup & Teardown

Robust cleanup is critical. The script registers handlers for all exit paths:

```ts
async function main() {
  const strategy = createStrategy(platform());
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await strategy.teardown().catch(err =>
      console.error("Teardown error:", err)
    );
  };

  // Normal exit
  process.on("exit", () => { cleanup(); });

  // Ctrl+C
  process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
  process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

  // Uncaught errors
  process.on("uncaughtException", async (err) => {
    console.error("Uncaught:", err);
    await cleanup();
    process.exit(1);
  });

  try {
    const env = await strategy.setup();
    const exitCode = await runPlaywright(env, process.argv.slice(2));
    await cleanup();
    process.exit(exitCode);
  } catch (err) {
    console.error("Virtual display failed, falling back:", err);
    await cleanup();
    const exitCode = await runPlaywright({}, process.argv.slice(2));
    process.exit(exitCode);
  }
}
```

### Per-platform teardown details

| Platform | Teardown action | Crash recovery |
|----------|----------------|----------------|
| Windows | PowerShell removes virtual desktop by GUID | `process.on('exit')` calls cleanup; orphaned desktops visible in Task View and can be manually closed |
| macOS | Close stdin to Swift helper → process exits → `CGVirtualDisplay` deallocated | If helper is killed, macOS auto-removes virtual display |
| Linux | `xvfb-run` auto-cleans when child exits | Lock file `/tmp/.X*-lock` cleaned on next `xvfb-run --auto-servernum` |

---

## npm Script Integration

Add to `package.json`:

```json
{
  "scripts": {
    "test:e2e:bg": "bun scripts/e2e-virtual-display.ts",
    "test:e2e:bg:record": "bun scripts/e2e-virtual-display.ts -- --video"
  }
}
```

Usage:

```bash
# Run E2E tests in virtual display (no focus steal)
bun run test:e2e:bg

# Pass args through to Playwright
bun run test:e2e:bg -- --grep "timeline"

# Existing commands unchanged
bun run test:e2e          # Direct launch (default)
bun run test:e2e:headed   # Headed, visible
bun run test:e2e:ui       # Playwright UI mode
```

---

## Fallback Chain Summary

```
Platform detected
  │
  ├─ Windows
  │   ├─ Try: Virtual Desktop API (COM)
  │   └─ Fallback: Window position (-2000, -2000)
  │
  ├─ macOS
  │   ├─ Try: CGVirtualDisplay (macOS 14+)
  │   └─ Fallback: Window position (-2000, -2000)
  │
  ├─ Linux
  │   ├─ Try: xvfb-run
  │   ├─ Fallback: Existing $DISPLAY
  │   └─ Error: No display available
  │
  └─ Unknown: Direct launch (no virtual display)
```

If any strategy's `setup()` throws, the script catches it and falls back to running Playwright directly — tests still work, they just may be visible.

---

## Risk Assessment Summary

| Platform | Approach | Confidence | Primary Risk |
|----------|----------|------------|--------------|
| **Windows** | Virtual Desktop API | Medium | Undocumented COM GUIDs change across Windows builds |
| **macOS** | CGVirtualDisplay | High | Requires macOS 14+; fallback is solid |
| **Linux/CI** | Xvfb | Very High | Battle-tested; standard CI approach |
| **All** | Fallback (-2000,-2000) | Very High | Works everywhere, window just offscreen |

### Implementation Priority

1. **Linux/Xvfb** — Implement first (simplest, highest CI value)
2. **Windows Virtual Desktop** — Implement second (primary dev platform for QCut)
3. **macOS CGVirtualDisplay** — Implement last (fewest users, good fallback)

---

## File Manifest

| File | Purpose |
|------|---------|
| `scripts/e2e-virtual-display.ts` | Main entry point — platform detection, strategy dispatch, Playwright launch |
| `scripts/e2e-virtual-display-win.ps1` | Windows Virtual Desktop COM interop |
| `scripts/e2e-virtual-display-mac.swift` | macOS CGVirtualDisplay helper |
| `electron/main.ts` | Minor addition: read `QCUT_E2E_*` env vars to position window |
| `package.json` | Add `test:e2e:bg` script |
| `playwright.config.ts` | No changes needed |

---

## Related

- [Playwright E2E Screen Solutions](./playwright-e2e-screen-solutions.md) — Overview of all approaches
- [Testing Guide](../reference/testing-guide.md) — General testing documentation
