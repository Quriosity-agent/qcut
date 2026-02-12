# Why preload.js Is Not Working

## The Error

```text
Unable to load preload script: /Users/peter/Desktop/code/qcut/qcut/dist/electron/preload.js
Error: module not found: ./preload-integrations.js
    at preloadRequire (VM4 sandbox_bundle:2:143993)
```

## Root Cause: Electron Sandbox Mode

**Since Electron v20, preload scripts run in a sandboxed environment by default.** QCut uses Electron v37.4.0.

In `electron/main.ts:421-428`, the BrowserWindow is created with:

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  preload: path.join(__dirname, "./preload.js"),
}
```

The `sandbox` option is **not explicitly set**, so it defaults to `true` (the Electron v20+ default).

### What Sandbox Does to Preload Scripts

In sandbox mode, Electron replaces Node.js's real `require()` with a restricted `preloadRequire()` function. This restricted require:

- **CAN** load built-in Electron modules (`electron`, `electron/renderer`)
- **CANNOT** load relative files (`./preload-integrations.js`)
- **CANNOT** load Node.js built-in modules (`fs`, `path`, `child_process`)
- **CANNOT** load npm packages

So when `dist/electron/preload.js` line 12 runs:

```js
const preload_integrations_js_1 = require("./preload-integrations.js");
```

The sandboxed `preloadRequire` can't resolve it, and throws `module not found: ./preload-integrations.js`.

### Why the Files Exist But Still Fail

Both files are correctly compiled and present:

- `dist/electron/preload.js` (8,157 bytes)
- `dist/electron/preload-integrations.js` (13,122 bytes)

The build pipeline works fine. The issue is **runtime module resolution**, not a build problem. The sandbox `preloadRequire` simply doesn't support multi-file require chains.

## Two Fix Options

### Option A: Bundle Preload Into a Single File (Recommended)

Bundle `preload.ts` and all its imports (`preload-integrations.ts`, `preload-types.ts`) into one self-contained JS file using esbuild or a similar bundler. This is the standard pattern for sandboxed Electron apps.

Example build script change:

```json
"build:electron:preload": "esbuild electron/preload.ts --bundle --platform=node --outfile=dist/electron/preload.js --external:electron"
```

This inlines `preload-integrations.js` into `preload.js` so there's no `require()` call for the sandbox to reject.

**Pros**: Maintains security best practices (sandbox stays on), matches Electron's recommended approach.

**Cons**: Requires adding esbuild as a build step for the preload script.

### Option B: Disable Sandbox (Quick Fix, Not Recommended)

Add `sandbox: false` to the BrowserWindow webPreferences:

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,  // <-- disables the sandboxed preload
  preload: path.join(__dirname, "./preload.js"),
}
```

**Pros**: One-line fix, no build changes needed.

**Cons**: Reduces security. The renderer process gets more access to Node.js internals. Electron docs explicitly recommend keeping sandbox enabled.

## Why This Wasn't Caught Earlier

The error only appears in the Electron console (DevTools), not in the terminal. The app still loads because the renderer (Vite dev server or `app://` protocol) works independently. However, **all `window.electronAPI.*` calls silently fail** because `contextBridge.exposeInMainWorld` never executes when the preload script crashes.

This means: `isElectron()` returns `false`, exports fall back to browser mode, file operations don't work, etc. The console log at line 38-39 of the task confirms this:

```text
use-export-progress.ts:104   - isElectron(): false
```

## References

- [Electron Issue #36437 - sandbox by default breaks preload](https://github.com/electron/electron/issues/36437)
- [Electron Issue #36012 - Cannot require native modules in sandboxed preload](https://github.com/electron/electron/issues/36012)
- [Electron Docs - Preload Scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
- [electron-vite Troubleshooting](https://electron-vite.org/guide/troubleshooting)
