# E2E Testing Infrastructure - QCut Video Editor

## Overview

QCut's End-to-End (E2E) testing infrastructure provides comprehensive testing for the Electron-based video editor application. The test suite uses Playwright to automate real user interactions across the entire application stack, from project creation to media import and timeline editing.

## Architecture

### Tech Stack
- **Framework**: Playwright with TypeScript
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
├── playwright.config.ts                 # Playwright configuration
├── apps/web/src/test/e2e/
│   ├── helpers/
│   │   └── electron-helpers.ts          # Core helper functions and fixtures
│   ├── fixtures/media/                  # Test media files
│   │   ├── sample-video.mp4            # 5-second 720p test video
│   │   ├── sample-audio.mp3            # 5-second sine wave audio
│   │   └── sample-image.png            # 1280x720 blue test image
│   └── test files/
│       ├── simple-navigation.e2e.ts    # Basic navigation tests
│       ├── editor-navigation.e2e.ts    # Editor-specific navigation
│       ├── project-workflow-part1.e2e.ts  # Project creation & media import
│       ├── project-workflow-part2.e2e.ts  # Timeline operations
│       ├── project-workflow-part3.e2e.ts  # Export & persistence
│       ├── ai-enhancement-*.e2e.ts     # AI feature tests
│       ├── sticker-text-overlay-*.e2e.ts  # Overlay feature tests
│       ├── auto-save-*.e2e.ts          # Auto-save feature tests
│       └── cross-platform-*.e2e.ts    # Cross-platform tests
└── test-results/                       # Generated test artifacts (gitignored)
```

## Core Functions and Architecture

### Electron Helpers (`electron-helpers.ts`)

#### 1. Test Fixtures
```typescript
export interface ElectronFixtures {
  electronApp: ElectronApplication;  // Electron app instance
  page: Page;                       // Main window page
}
```

#### 2. Core Navigation Functions
```typescript
// Navigates from home page to projects page
export async function navigateToProjects(page: Page)

// Creates a new project (handles both empty state and existing projects)
export async function createTestProject(page: Page, projectName?: string)

// Waits for project to fully load in editor
export async function waitForProjectLoad(page: Page)
```

#### 3. Media Import Functions
```typescript
// Uploads any test media file
export async function uploadTestMedia(page: Page, filePath: string)

// Specific media type imports
export async function importTestVideo(page: Page)
export async function importTestAudio(page: Page)
export async function importTestImage(page: Page)
```

#### 4. Utility Functions
```typescript
// Starts Electron app with test configuration
export async function startElectronApp()

// Gets main window with readiness checks
export async function getMainWindow(electronApp: ElectronApplication)

// Waits for app to be fully ready
export async function waitForAppReady(page: Page)
```

## Test Architecture Diagram

```mermaid
graph TD
    A[Playwright Test Runner] --> B[Electron App Launch]
    B --> C[Main Window Ready]
    C --> D[Navigate to Projects]
    D --> E{Test Type}

    E -->|Navigation| F[Simple Navigation Tests]
    E -->|Workflow| G[Project Workflow Tests]
    E -->|Features| H[Feature-Specific Tests]

    F --> I[Verify UI Elements]
    G --> J[Create Project] --> K[Import Media] --> L[Timeline Operations]
    H --> M[AI Enhancement]
    H --> N[Sticker/Text Overlay]
    H --> O[Auto-save]

    J --> P[Media Fixtures]
    K --> P
    L --> Q[Timeline Validation]

    I --> R[Test Results]
    Q --> R
    M --> R
    N --> R
    O --> R
```

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

#### Run All E2E Tests
```bash
cd qcut
bun x playwright test --project=electron
```

#### Run Specific Test Files
```bash
# Basic navigation tests
bun x playwright test simple-navigation.e2e.ts --project=electron

# Project workflow tests
bun x playwright test project-workflow-part1.e2e.ts --project=electron

# Editor navigation tests
bun x playwright test editor-navigation.e2e.ts --project=electron
```

#### Run Single Test
```bash
# Run specific test by line number
bun x playwright test project-workflow-part1.e2e.ts:19 --project=electron

# Run by test name pattern
bun x playwright test --project=electron --grep "should create project"
```

#### Debug Mode
```bash
# Run with headed browser for debugging
bun x playwright test --project=electron --headed

# Run with debug mode (step through)
bun x playwright test --project=electron --debug
```

#### Test Reports
```bash
# Generate and open HTML report
bun x playwright show-report

# Run with specific reporter
bun x playwright test --project=electron --reporter=html
```

### Configuration Options

#### Playwright Configuration (`playwright.config.ts`)
```typescript
export default defineConfig({
  testDir: './apps/web/src/test/e2e',
  fullyParallel: false,        // Sequential execution for Electron
  workers: 1,                  // Single worker to avoid port conflicts
  retries: process.env.CI ? 2 : 0,
  timeout: 30000,              // 30-second test timeout

  projects: [{
    name: 'electron',
    testMatch: '**/*.e2e.ts'
  }]
});
```

## Test Categories

### 1. Navigation Tests (`simple-navigation.e2e.ts`)
- Basic app navigation
- Project page loading
- Button detection and interaction
- No actual project creation (safe for repeated runs)

### 2. Project Workflow Tests
#### Part 1 (`project-workflow-part1.e2e.ts`)
- Project creation
- Media import (video, audio, image)
- Basic file upload processes

#### Part 2 (`project-workflow-part2.e2e.ts`)
- Timeline operations
- Media element manipulation
- Drag-and-drop functionality

#### Part 3 (`project-workflow-part3.e2e.ts`)
- Project persistence
- Export functionality
- Session state management

### 3. Feature-Specific Tests
- **AI Enhancement**: AI-powered video enhancement features
- **Sticker/Text Overlay**: Adding stickers and text to timeline
- **Auto-save**: Automatic project saving functionality
- **Cross-platform**: File handling across different environments

## Best Practices

### 1. Test Data Management
- Use pre-created test media files
- Clean up test projects after runs (when needed)
- Use descriptive project names with timestamps

### 2. Waiting Strategies
```typescript
// ✅ Good: State-based waiting
await page.waitForSelector('[data-testid="timeline-track"]');

// ❌ Bad: Fixed timeouts
await page.waitForTimeout(5000);
```

### 3. Element Selection
```typescript
// ✅ Good: Use data-testid attributes
await page.getByTestId('new-project-button').click();

// ✅ Good: Use semantic selectors as fallback
await page.locator('text=New Project').click();

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

### CI/CD Integration

```yaml
# Example GitHub Actions integration
- name: Run E2E Tests
  run: |
    cd qcut
    bun run build
    bun x playwright test --project=electron --reporter=html
```

## Performance Considerations

- **Sequential Execution**: Tests run one at a time to avoid resource conflicts
- **Shared Test Media**: Reuse pre-created media files instead of generating new ones
- **State Cleanup**: Tests handle existing projects gracefully without requiring cleanup
- **Timeout Management**: Appropriate timeouts for different operations (navigation: 10s, media import: 15s)

## Future Enhancements

- **Parallel Test Execution**: Investigate running tests in parallel with isolated Electron instances
- **Visual Regression Testing**: Add screenshot comparison tests for UI consistency
- **Performance Testing**: Measure and assert on video processing performance
- **Cross-Platform Testing**: Test on Windows, macOS, and Linux
- **Mobile Testing**: Test responsive design on different screen sizes

---

This E2E testing infrastructure provides comprehensive coverage of QCut's video editing functionality while maintaining reliability and ease of use for developers.