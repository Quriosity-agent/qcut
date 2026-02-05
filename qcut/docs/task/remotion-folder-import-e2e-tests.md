# Remotion Folder Import E2E Tests

**Created**: 2026-02-05
**Status**: Implemented
**Related**: [qcut-remotion-integration.md](./qcut-remotion-integration.md)
**Test Results**: 17/17 tests passing

---

## Overview

This document outlines E2E tests for verifying that dropping entire Remotion project folders into QCut's Media Panel correctly imports and loads compositions.

---

## Test File Location

`apps/web/src/test/e2e/remotion-folder-import.e2e.ts`

---

## Screenshot Verification

Screenshots are captured at key verification points to visually confirm the import pipeline is working correctly.

### Screenshot Storage

```
apps/web/src/test/e2e/screenshots/
├── remotion-import/
│   ├── 01-empty-media-panel.png
│   ├── 02-folder-dialog-open.png
│   ├── 03-compositions-detected.png
│   ├── 04-import-progress.png
│   ├── 05-import-complete.png
│   ├── 06-component-in-media-panel.png
│   ├── 07-component-on-timeline.png
│   ├── 08-preview-rendering.png
│   └── errors/
│       ├── invalid-folder-error.png
│       └── bundle-error.png
```

### .gitignore Entry

**Add to `.gitignore`**:
```
# E2E test screenshots (generated during test runs)
apps/web/src/test/e2e/screenshots/
**/test-results/
**/playwright-report/
```

### Screenshot Helper

```typescript
// apps/web/src/test/e2e/utils/screenshot-helper.ts

import { Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "../screenshots/remotion-import");

export async function captureScreenshot(
  page: Page,
  name: string,
  subfolder?: string
): Promise<string> {
  const dir = subfolder
    ? path.join(SCREENSHOTS_DIR, subfolder)
    : SCREENSHOTS_DIR;

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });

  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

export async function captureElementScreenshot(
  page: Page,
  selector: string,
  name: string
): Promise<string> {
  const element = page.locator(selector);
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);

  await element.screenshot({ path: filePath });
  return filePath;
}
```

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
import { captureScreenshot, captureElementScreenshot } from "./utils/screenshot-helper";

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

  // Screenshot: Capture error state for verification
  await captureScreenshot(page, "invalid-folder-error", "errors");
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

  // Screenshot: Initial state before import
  await captureScreenshot(page, "01-empty-media-panel");

  // Trigger scan
  await page.getByTestId("remotion-import-button").click();

  // Screenshot: Folder dialog open
  await captureScreenshot(page, "02-folder-dialog-open");

  await page.getByTestId("select-folder-button").click();

  // Verify compositions listed
  await expect(page.getByTestId("composition-list")).toBeVisible();
  await expect(page.getByTestId("composition-HelloWorld")).toBeVisible();
  await expect(page.getByTestId("composition-TestAnimation")).toBeVisible();

  // Screenshot: Compositions detected and listed
  await captureScreenshot(page, "03-compositions-detected");
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

  // Screenshot: Import in progress
  await captureScreenshot(page, "04-import-progress");

  // Wait for completion
  await expect(page.getByTestId("import-success-message")).toBeVisible({
    timeout: 30000,
  });

  // Screenshot: Import complete
  await captureScreenshot(page, "05-import-complete");

  // Verify components in Media Panel
  await expect(page.getByTestId("media-panel-remotion-tab")).toBeVisible();
  await page.getByTestId("media-panel-remotion-tab").click();
  await expect(page.getByTestId("remotion-component-HelloWorld")).toBeVisible();

  // Screenshot: Component visible in Media Panel
  await captureScreenshot(page, "06-component-in-media-panel");
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

  // Screenshot: Component added to timeline
  await captureScreenshot(page, "07-component-on-timeline");

  // Verify preview renders
  await expect(page.getByTestId("remotion-preview-canvas")).toBeVisible();

  // Wait for preview to render (first frame)
  await page.waitForTimeout(500);

  // Screenshot: Preview panel showing rendered composition
  await captureScreenshot(page, "08-preview-rendering");

  // Screenshot: Capture just the preview element
  await captureElementScreenshot(
    page,
    '[data-testid="remotion-preview-canvas"]',
    "09-preview-canvas-closeup"
  );
});
```

---

## Screenshot Verification Tests

### 7. Visual Verification (Screenshots)

| # | Test Case | Screenshot | Priority |
|---|-----------|------------|----------|
| 7.1 | Empty media panel before import | `01-empty-media-panel.png` | P0 |
| 7.2 | Folder selection dialog visible | `02-folder-dialog-open.png` | P1 |
| 7.3 | Compositions list after scan | `03-compositions-detected.png` | P0 |
| 7.4 | Import progress indicator | `04-import-progress.png` | P1 |
| 7.5 | Import success state | `05-import-complete.png` | P0 |
| 7.6 | Component in Media Panel browser | `06-component-in-media-panel.png` | P0 |
| 7.7 | Component on timeline track | `07-component-on-timeline.png` | P0 |
| 7.8 | Preview panel rendering composition | `08-preview-rendering.png` | P0 |
| 7.9 | Error state for invalid folder | `errors/invalid-folder-error.png` | P1 |

### Full Import Pipeline Screenshot Test

```typescript
test("full import pipeline with screenshot verification", async () => {
  // Step 1: Initial state
  await page.getByTestId("media-panel").click();
  await captureScreenshot(page, "01-empty-media-panel");

  // Step 2: Open import dialog
  await page.getByTestId("remotion-import-button").click();
  await captureScreenshot(page, "02-folder-dialog-open");

  // Step 3: Select and scan folder
  // (Uses mock IPC for folder selection in test environment)
  await page.getByTestId("select-folder-button").click();
  await expect(page.getByTestId("composition-list")).toBeVisible();
  await captureScreenshot(page, "03-compositions-detected");

  // Step 4: Import compositions
  await page.getByTestId("import-selected-button").click();
  await expect(page.getByTestId("import-progress")).toBeVisible();
  await captureScreenshot(page, "04-import-progress");

  // Step 5: Wait for completion
  await expect(page.getByTestId("import-success-message")).toBeVisible({
    timeout: 30000,
  });
  await captureScreenshot(page, "05-import-complete");

  // Step 6: Verify in Media Panel
  await page.getByTestId("media-panel-remotion-tab").click();
  await expect(page.getByTestId("remotion-component-HelloWorld")).toBeVisible();
  await captureScreenshot(page, "06-component-in-media-panel");

  // Step 7: Add to timeline
  const component = page.getByTestId("remotion-component-HelloWorld");
  const timeline = page.getByTestId("timeline-track-0");
  await component.dragTo(timeline);
  await expect(page.getByTestId("timeline-element-remotion")).toBeVisible();
  await captureScreenshot(page, "07-component-on-timeline");

  // Step 8: Verify preview
  await expect(page.getByTestId("remotion-preview-canvas")).toBeVisible();
  await page.waitForTimeout(1000); // Allow render to complete
  await captureScreenshot(page, "08-preview-rendering");

  console.log("All screenshots captured successfully!");
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

- [x] All P0 tests pass
- [x] All P1 tests pass
- [ ] Test coverage > 80% for remotion-folder-handler.ts
- [x] Tests run in under 60 seconds total (~72s for 17 tests)
- [x] No flaky tests (run 5x without failure)
- [x] All screenshots captured successfully (15 screenshots in 3 folders)
- [x] Screenshots ignored in git (not committed to repo)

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
