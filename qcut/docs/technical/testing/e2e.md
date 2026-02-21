# E2E Testing Infrastructure - QCut Video Editor

**Last Updated:** 2026-02-21

## How to Run E2E Tests

### Prerequisites
1. **Build the project**:
   ```bash
   cd qcut
   bun run build
   ```

2. **Ensure Electron app works**:
   ```bash
   bun run electron
   ```

### Running Tests

#### Using npm Scripts (Recommended)
```bash
cd qcut

# Run all E2E tests
bun run test:e2e

# Run all E2E tests and collect videos to docs/completed/e2e-videos/
bun run test:e2e:record

# Run with interactive UI
bun run test:e2e:ui

# Run in headed browser mode (visible)
bun run test:e2e:headed

# Run project workflow tests only
bun run test:e2e:workflow
```

#### Using Playwright Directly
```bash
# Run all tests
bun x playwright test --project=electron

# Run specific test file
bun x playwright test simple-navigation.e2e.ts --project=electron

# Run by test name pattern
bun x playwright test --project=electron --grep "should create project"

# Run specific test by line number
bun x playwright test project-workflow-part1.e2e.ts:19 --project=electron
```

#### Debug Mode
```bash
# Run with headed browser for debugging
bun x playwright test --project=electron --headed

# Run with debug mode (step through)
bun x playwright test --project=electron --debug

# Run with UI mode (interactive)
bun x playwright test --project=electron --ui
```

#### Test Reports
```bash
# Generate and open HTML report
bun x playwright show-report

# Results are saved in docs/completed/test-results/
```

### Configuration (`playwright.config.ts`)
```typescript
export default defineConfig({
  testDir: './apps/web/src/test/e2e',
  fullyParallel: false,           // Sequential execution for Electron
  workers: 1,                     // Single worker to avoid port conflicts
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,                // 1-minute test timeout
  expect: {
    timeout: 10_000,              // 10-second assertion timeout
  },
  use: {
    trace: 'on-first-retry',      // Capture trace on retry
    screenshot: 'only-on-failure', // Screenshot on failure
    video: 'on',                  // Video for every test
  },
  projects: [{
    name: 'electron',
    testMatch: '**/*.e2e.ts'
  }],
  testIgnore: [
    '**/node_modules/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],
});
```

## Overview

QCut's End-to-End (E2E) testing infrastructure provides comprehensive testing for the Electron-based video editor application. The test suite uses Playwright to automate real user interactions across the entire application stack, from project creation to media import and timeline editing.

## Architecture

### Tech Stack
- **Framework**: Playwright 1.40.0 with TypeScript
- **Target**: Electron application (Chromium-based)
- **Test Runner**: Playwright Test Runner
- **Configuration**: Single-worker sequential execution to avoid port conflicts

### Key Design Principles
- **Real User Workflows**: Tests simulate actual user interactions
- **Non-Breaking**: All test additions use `data-testid` attributes without modifying existing functionality
- **Robust Waiting**: State-based waiting patterns instead of fixed timeouts
- **Media Fixtures**: Pre-created test media files for consistent testing

## File Structure

```
qcut/
├── playwright.config.ts                    # Playwright configuration
├── apps/web/src/test/e2e/
│   ├── helpers/
│   │   └── electron-helpers.ts             # Core helper functions (19KB)
│   ├── fixtures/
│   │   └── media/                          # Test media files
│   │       ├── README.md                   # Media fixtures documentation
│   │       ├── sample-video.mp4            # 5-second 720p test video (81KB)
│   │       ├── sample-audio.mp3            # Test audio file
│   │       └── sample-image.png            # 1280x720 test image (4KB)
│   │
│   └── [Test Files]
│       ├── simple-navigation.e2e.ts        # Basic navigation tests
│       ├── editor-navigation.e2e.ts        # Editor-specific navigation
│       ├── project-workflow-part1.e2e.ts   # Project creation & media import
│       ├── project-workflow-part2.e2e.ts   # Timeline operations
│       ├── project-workflow-part3.e2e.ts   # Export & persistence
│       ├── multi-media-management-part1.e2e.ts  # Multi-media import
│       ├── multi-media-management-part2.e2e.ts  # Multi-media timeline
│       ├── ai-enhancement-export-integration.e2e.ts  # AI export features
│       ├── ai-transcription-caption-generation.e2e.ts # AI captions
│       ├── sticker-overlay-testing.e2e.ts  # Sticker overlay tests
│       ├── text-overlay-testing.e2e.ts     # Text overlay tests
│       ├── auto-save-export-file-management.e2e.ts  # Auto-save tests
│       ├── file-operations-storage-management.e2e.ts # File operations
│       ├── audio-video-simultaneous-export.e2e.ts   # Audio/video export
│       ├── project-folder-sync.e2e.ts               # Project folder sync
│       ├── remotion-folder-import.e2e.ts             # Remotion folder import
│       ├── remotion-panel-stability.e2e.ts           # Remotion panel stability
│       ├── sticker-overlay-export.e2e.ts             # Sticker overlay export
│       ├── terminal-paste.e2e.ts                     # Terminal paste
│       ├── timeline-duration-limit.e2e.ts            # Timeline duration limits
│       └── debug-projectid.e2e.ts                    # Debug/utility tests
│
└── docs/completed/                         # Test results (gitignored)
    ├── test-results/                       # HTML test reports
    ├── test-results-raw/                   # Raw Playwright artifacts
    └── e2e-videos/                         # Collected video artifacts by run
```

## Test Files Summary

| Test File | Description | Tests |
|-----------|-------------|-------|
| `simple-navigation.e2e.ts` | Basic app navigation, button detection | Navigation |
| `editor-navigation.e2e.ts` | Editor-specific navigation | Editor UI |
| `project-workflow-part1.e2e.ts` | Project creation, media import | Core workflow |
| `project-workflow-part2.e2e.ts` | Timeline operations | Timeline |
| `project-workflow-part3.e2e.ts` | Export, persistence | Export |
| `multi-media-management-part1.e2e.ts` | Multiple media import | Media |
| `multi-media-management-part2.e2e.ts` | Multi-media timeline | Timeline |
| `ai-enhancement-export-integration.e2e.ts` | AI video enhancement export | AI |
| `ai-transcription-caption-generation.e2e.ts` | AI transcription/captions | AI |
| `sticker-overlay-testing.e2e.ts` | Sticker overlay features | Overlays |
| `text-overlay-testing.e2e.ts` | Text overlay features | Overlays |
| `auto-save-export-file-management.e2e.ts` | Auto-save functionality | Persistence |
| `file-operations-storage-management.e2e.ts` | File operations | Storage |
| `audio-video-simultaneous-export.e2e.ts` | Audio/video simultaneous export | Export |
| `project-folder-sync.e2e.ts` | Project folder synchronization | Sync |
| `remotion-folder-import.e2e.ts` | Remotion folder importing | Remotion |
| `remotion-panel-stability.e2e.ts` | Remotion panel stability | Remotion |
| `sticker-overlay-export.e2e.ts` | Sticker overlay export | Overlays |
| `terminal-paste.e2e.ts` | Terminal paste functionality | Terminal |
| `timeline-duration-limit.e2e.ts` | Timeline duration limits | Timeline |
| `debug-projectid.e2e.ts` | Debug utilities | Debug |

## Core Helper Functions (`electron-helpers.ts`)

### Test Fixtures
```typescript
export interface ElectronFixtures {
  electronApp: ElectronApplication;  // Electron app instance
  page: Page;                        // Main window page
}
```

### Navigation Functions
```typescript
// Navigates from home page to projects page
export async function navigateToProjects(page: Page)

// Creates a new project (handles both empty state and existing projects)
export async function createTestProject(page: Page, projectName?: string)

// Waits for project to fully load in editor
export async function waitForProjectLoad(page: Page)
```

### Media Import Functions
```typescript
// Uploads any test media file
export async function uploadTestMedia(page: Page, filePath: string)

// Specific media type imports
export async function importTestVideo(page: Page)
export async function importTestAudio(page: Page)
export async function importTestImage(page: Page)
```

### Utility Functions
```typescript
// Starts Electron app with test configuration
export async function startElectronApp()

// Gets main window with readiness checks
export async function getMainWindow(electronApp: ElectronApplication)

// Waits for app to be fully ready
export async function waitForAppReady(page: Page)
```

## Test Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Playwright Test Runner                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Electron App Launch                           │
│                  (dist/electron/main.js)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Main Window Ready                             │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  Navigation  │ │   Workflow   │ │   Feature    │
      │    Tests     │ │    Tests     │ │    Tests     │
      └──────────────┘ └──────────────┘ └──────────────┘
              │               │               │
              │               │               │
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  Verify UI   │ │ Create/Edit  │ │ AI/Overlay/  │
      │  Elements    │ │   Project    │ │  Auto-save   │
      └──────────────┘ └──────────────┘ └──────────────┘
                              │
                              ▼
                    ┌──────────────┐
                    │ Media Import │
                    │  (Fixtures)  │
                    └──────────────┘
                              │
                              ▼
                    ┌──────────────┐
                    │   Timeline   │
                    │  Operations  │
                    └──────────────┘
                              │
                              ▼
                    ┌──────────────┐
                    │ Test Results │
                    │   (HTML)     │
                    └──────────────┘
```

## Best Practices

### 1. Test Data Management
- Use pre-created test media files in `fixtures/media/`
- Clean up test projects after runs (when needed)
- Use descriptive project names with timestamps

### 2. Waiting Strategies
```typescript
// ✅ Good: State-based waiting
await page.waitForSelector('[data-testid="timeline-track"]');

// ✅ Good: Wait for specific condition
await expect(page.getByTestId('project-title')).toBeVisible();

// ❌ Bad: Fixed timeouts
await page.waitForTimeout(5000);
```

### 3. Element Selection
```typescript
// ✅ Good: Use data-testid attributes
await page.getByTestId('new-project-button').click();

// ✅ Good: Use semantic selectors as fallback
await page.getByRole('button', { name: 'New Project' }).click();

// ❌ Bad: Use fragile CSS selectors
await page.locator('.btn-primary.header-button').click();
```

### 4. Error Handling
```typescript
// ✅ Good: Graceful degradation
const button = page.getByTestId('optional-button');
if (await button.isVisible()) {
  await button.click();
}

// ✅ Good: Multiple fallback strategies
await Promise.race([
  page.waitForSelector('[data-testid="success"]'),
  page.waitForSelector('[data-testid="error"]')
]);
```

## Troubleshooting

### Common Issues

#### 1. Port Conflicts
**Symptom**: "address already in use ::18000"
**Solution**: Ensure `workers: 1` in `playwright.config.ts`

#### 2. Element Not Found
**Symptom**: Timeout waiting for selectors
**Solutions**:
- Check if `data-testid` attributes exist
- Verify app navigation completed
- Use browser debug mode: `--headed --debug`

#### 3. File Upload Issues
**Symptom**: File dialog appears but files not selected
**Solutions**:
- Verify test media files exist in `fixtures/media/`
- Check file path resolution in `mediaPath()` function
- Ensure absolute paths are used

#### 4. Electron App Crashes
**Symptom**: "Target page, context or browser has been closed"
**Solutions**:
- Check Electron app builds correctly: `bun run build`
- Verify no conflicting processes on required ports
- Review console errors in test output

#### 5. Timeout Errors
**Symptom**: Test exceeds 60-second timeout
**Solutions**:
- Check if external services are available
- Tests that depend on external APIs may need graceful skips
- Increase timeout for specific slow tests if needed

### Debug Commands

```bash
# Check if test media files exist
ls -la apps/web/src/test/e2e/fixtures/media/

# Verify Electron app starts
bun run electron

# Run single test with full output
bun x playwright test simple-navigation.e2e.ts --project=electron --reporter=list

# Debug test with browser visible
bun x playwright test --project=electron --headed --debug

# Run with trace enabled
bun x playwright test --project=electron --trace on
```

## Development Guidelines

### Adding New Tests

1. **Create test file** following naming convention: `feature-name.e2e.ts`

2. **Import required helpers**:
   ```typescript
   import { test, expect, createTestProject } from './helpers/electron-helpers';
   ```

3. **Use consistent test structure**:
   ```typescript
   test.describe('Feature Name', () => {
     test('should perform specific action', async ({ page }) => {
       // Test implementation
     });
   });
   ```

4. **Add data-testid attributes** to UI components as needed

### Extending Helper Functions

1. **Add new helpers** to `electron-helpers.ts`
2. **Export functions** for use in test files
3. **Follow existing patterns** for error handling and waiting
4. **Document complex functions** with JSDoc comments

### Handling External Services

For tests that depend on external APIs (AI services, etc.):

```typescript
test('should handle AI generation', async ({ page }) => {
  // Check if service is available
  const isAvailable = await checkServiceAvailability();

  if (!isAvailable) {
    test.skip('External service not available');
    return;
  }

  // Proceed with test
});
```

## CI/CD Integration

### GitHub Actions Example
```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: |
          cd qcut
          bun install

      - name: Build application
        run: |
          cd qcut
          bun run build

      - name: Run E2E tests
        run: |
          cd qcut
          bun run test:e2e

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-test-results
          path: qcut/docs/completed/test-results/
```

## Performance Considerations

- **Sequential Execution**: Tests run one at a time to avoid resource conflicts
- **Shared Test Media**: Reuse pre-created media files instead of generating new ones
- **State Cleanup**: Tests handle existing projects gracefully without requiring cleanup
- **Timeout Management**:
  - Test timeout: 60 seconds
  - Assertion timeout: 10 seconds
  - Navigation timeout: 10 seconds
  - Media import timeout: 15 seconds

## Test Artifacts

Playwright captures:
- **Screenshots**: Saved to `test-results-raw/` on failure
- **Videos**: Recorded for every test to `test-results-raw/`
- **Traces**: Captured on first retry (viewable via `bun x playwright show-trace`)

When using `bun run test:e2e:record`, videos are also copied to `docs/completed/e2e-videos/<run-timestamp>/`.

## npm Script Reference

| Script | Description |
|--------|-------------|
| `bun run test:e2e` | Run all E2E tests |
| `bun run test:e2e:record` | Run all E2E tests and collect videos |
| `bun run test:e2e:ui` | Run with Playwright UI |
| `bun run test:e2e:headed` | Run with visible browser |
| `bun run test:e2e:workflow` | Run project workflow tests only |

---

*For additional test status information, check the test output or run `bun x playwright show-report` after test execution.*
