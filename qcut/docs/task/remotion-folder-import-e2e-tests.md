# Remotion Folder Import E2E Tests

**Created**: 2026-02-05
**Status**: Planned
**Related**: [qcut-remotion-integration.md](./qcut-remotion-integration.md)

---

## Overview

This document outlines E2E tests for verifying that dropping entire Remotion project folders into QCut's Media Panel correctly imports and loads compositions.

---

## Test File Location

`apps/web/src/test/e2e/remotion-folder-import.e2e.ts`

---

## Test Categories

### 1. Folder Selection & Validation

| # | Test Case | Priority |
|---|-----------|----------|
| 1.1 | Valid Remotion folder opens dialog and imports | P0 |
| 1.2 | Folder without package.json shows error | P0 |
| 1.3 | Folder without Remotion dependency shows error | P0 |
| 1.4 | Folder without Root.tsx shows error | P1 |
| 1.5 | Empty folder shows appropriate error | P1 |

### 2. Composition Scanning

| # | Test Case | Priority |
|---|-----------|----------|
| 2.1 | Single composition is detected and listed | P0 |
| 2.2 | Multiple compositions are detected and listed | P0 |
| 2.3 | Composition metadata extracted correctly (id, fps, dimensions, duration) | P0 |
| 2.4 | Compositions without id are skipped with warning | P1 |
| 2.5 | Nested compositions are detected | P2 |

### 3. Bundling & Loading

| # | Test Case | Priority |
|---|-----------|----------|
| 3.1 | esbuild bundles composition entry points | P0 |
| 3.2 | Bundled components register in Remotion store | P0 |
| 3.3 | Components appear in Media Panel browser | P0 |
| 3.4 | Components persist after app reload (IndexedDB) | P1 |
| 3.5 | Bundle errors display helpful error messages | P1 |
| 3.6 | Missing esbuild shows installation prompt | P2 |

### 4. Drag & Drop Import

| # | Test Case | Priority |
|---|-----------|----------|
| 4.1 | Dropping valid folder triggers import pipeline | P0 |
| 4.2 | Drop zone visual feedback on drag over | P1 |
| 4.3 | Dropping non-folder shows error | P1 |
| 4.4 | Dropping multiple folders imports all valid ones | P2 |
| 4.5 | Progress indicator shows during import | P1 |

### 5. Timeline Integration

| # | Test Case | Priority |
|---|-----------|----------|
| 5.1 | Imported composition can be added to timeline | P0 |
| 5.2 | Composition preview renders in preview panel | P0 |
| 5.3 | Composition props are editable in properties panel | P1 |
| 5.4 | Frame sync works between timeline and player | P1 |
| 5.5 | Trimming composition updates timeline element | P2 |

### 6. Error Handling & Recovery

| # | Test Case | Priority |
|---|-----------|----------|
| 6.1 | Invalid component gracefully degrades | P0 |
| 6.2 | Error logged to store (max 20 recent errors) | P1 |
| 6.3 | Re-import after fix works correctly | P1 |
| 6.4 | Partial import completes valid compositions | P2 |

---

## Implementation Details

### Test Setup

```typescript
// apps/web/src/test/e2e/remotion-folder-import.e2e.ts

import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";

const FIXTURES_DIR = path.join(__dirname, "../fixtures/remotion");
const VALID_PROJECT = path.join(FIXTURES_DIR, "valid-project");
const INVALID_PROJECT = path.join(FIXTURES_DIR, "invalid-project");

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, "../../../../electron/main.js")],
    env: { NODE_ENV: "test" },
  });
  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});
```

### Fixture Structure

```
apps/web/src/test/fixtures/remotion/
├── valid-project/
│   ├── package.json          # Has remotion dependency
│   ├── src/
│   │   └── Root.tsx          # Contains <Composition> elements
│   └── tsconfig.json
├── invalid-project/
│   └── package.json          # Missing remotion dependency
├── no-root-project/
│   └── package.json          # Has remotion but no Root.tsx
└── empty-folder/
```

### Mock package.json (valid)

```json
{
  "name": "test-remotion-project",
  "version": "1.0.0",
  "dependencies": {
    "remotion": "^4.0.0",
    "@remotion/player": "^4.0.0"
  }
}
```

### Mock Root.tsx (valid)

```tsx
import { Composition } from "remotion";
import { HelloWorld } from "./HelloWorld";
import { TestAnimation } from "./TestAnimation";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="TestAnimation"
        component={TestAnimation}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
```

---

## Key Assertions

### Folder Validation Test

```typescript
test("folder without Remotion dependency shows error", async () => {
  // Mock IPC response
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.handle("remotion-folder:validate", async (_, folderPath) => {
      return {
        success: false,
        error: "No remotion dependency found in package.json",
      };
    });
  });

  // Trigger import
  await page.getByTestId("remotion-import-button").click();

  // Verify error message
  await expect(page.getByTestId("import-error-message")).toContainText(
    "No remotion dependency"
  );
});
```

### Composition Scan Test

```typescript
test("multiple compositions are detected and listed", async () => {
  // Mock successful scan
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.handle("remotion-folder:scan", async () => {
      return {
        success: true,
        compositions: [
          { id: "HelloWorld", fps: 30, width: 1920, height: 1080, durationInFrames: 150 },
          { id: "TestAnimation", fps: 30, width: 1920, height: 1080, durationInFrames: 300 },
        ],
      };
    });
  });

  // Trigger scan
  await page.getByTestId("remotion-import-button").click();
  await page.getByTestId("select-folder-button").click();

  // Verify compositions listed
  await expect(page.getByTestId("composition-list")).toBeVisible();
  await expect(page.getByTestId("composition-HelloWorld")).toBeVisible();
  await expect(page.getByTestId("composition-TestAnimation")).toBeVisible();
});
```

### Drag & Drop Test

```typescript
test("dropping valid folder triggers import pipeline", async () => {
  const dropZone = page.getByTestId("remotion-drop-zone");

  // Simulate folder drop
  await dropZone.dispatchEvent("drop", {
    dataTransfer: {
      files: [{ path: VALID_PROJECT, type: "directory" }],
    },
  });

  // Verify import started
  await expect(page.getByTestId("import-progress")).toBeVisible();

  // Wait for completion
  await expect(page.getByTestId("import-success-message")).toBeVisible({
    timeout: 30000,
  });

  // Verify components in Media Panel
  await expect(page.getByTestId("media-panel-remotion-tab")).toBeVisible();
  await page.getByTestId("media-panel-remotion-tab").click();
  await expect(page.getByTestId("remotion-component-HelloWorld")).toBeVisible();
});
```

### Timeline Integration Test

```typescript
test("imported composition can be added to timeline", async () => {
  // Ensure component is in media panel
  await page.getByTestId("media-panel-remotion-tab").click();

  // Drag to timeline
  const component = page.getByTestId("remotion-component-HelloWorld");
  const timeline = page.getByTestId("timeline-track-0");

  await component.dragTo(timeline);

  // Verify element added
  await expect(page.getByTestId("timeline-element-remotion")).toBeVisible();

  // Verify preview renders
  await expect(page.getByTestId("remotion-preview-canvas")).toBeVisible();
});
```

---

## IPC Channel Testing

### Channels to Mock

| Channel | Test Scenarios |
|---------|----------------|
| `remotion-folder:select` | Success, cancelled, error |
| `remotion-folder:scan` | Valid project, invalid Root.tsx, parse error |
| `remotion-folder:bundle` | Success, esbuild error, timeout |
| `remotion-folder:import` | Full pipeline success, partial failure |
| `remotion-folder:validate` | Valid, missing package.json, missing dependency |

---

## Test Data Requirements

### Fixture Files Needed

1. **Valid Remotion project** with 2-3 simple compositions
2. **Invalid project** (no remotion in package.json)
3. **Project without Root.tsx**
4. **Empty folder**
5. **Project with syntax errors in Root.tsx**
6. **Project with complex nested compositions**

---

## Acceptance Criteria

- [ ] All P0 tests pass
- [ ] All P1 tests pass
- [ ] Test coverage > 80% for remotion-folder-handler.ts
- [ ] Tests run in under 60 seconds total
- [ ] No flaky tests (run 5x without failure)

---

## Related Files

### Frontend
- `src/components/editor/media-panel/remotion-browser.tsx`
- `src/lib/remotion/remotion-store.ts`
- `src/lib/remotion/component-loader.ts`

### Backend (Electron)
- `electron/remotion-folder-handler.ts`
- `electron/remotion-composition-parser.ts`
- `electron/remotion-bundler.ts`

### Types
- `src/types/remotion.d.ts`
- `electron/types/remotion-ipc.ts`
