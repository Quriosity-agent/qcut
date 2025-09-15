# Top 5 E2E Tests to Implement for QCut

**Document Version**: 1.0  
**Created**: 2025-01-12  
**Status**: Priority List for Implementation

## Executive Summary

Based on the current testing strategy and QCut's architecture, these are the **5 most critical E2E tests** that should be implemented first. These tests cover the core user workflows and critical business functionality that would have the highest impact on user experience if broken.

## Priority E2E Tests

### 1. 🎬 **Complete Video Project Workflow**
**Priority**: CRITICAL  
**Estimated Time**: 30-45 minutes  
**Coverage**: End-to-end project lifecycle

#### Test Scenario:
```typescript
// Path: apps/web/src/test/e2e/project-workflow.e2e.ts
1. Create new project with settings (1080p, 30fps)
2. Import video file (MP4)
3. Add video to timeline
4. Trim video (cut 5 seconds from start)
5. Save project
6. Reload project
7. Verify timeline state preserved
8. Export as MP4 (720p)
9. Verify output file exists
```

#### Why Critical:
- Covers the entire user journey from start to finish
- Tests data persistence across sessions
- Validates FFmpeg integration
- Ensures project state management works correctly

---

### 2. 📁 **Multi-Media Import and Timeline Management**
**Priority**: CRITICAL  
**Estimated Time**: 20-30 minutes  
**Coverage**: Media handling and timeline operations

#### Test Scenario:
```typescript
// Path: apps/web/src/test/e2e/media-timeline.e2e.ts
1. Import multiple media types:
   - Video file (MP4)
   - Audio file (MP3)
   - Image file (PNG)
2. Add all to timeline on different tracks
3. Arrange media:
   - Overlap audio with video
   - Position image as overlay
4. Test timeline controls:
   - Play/pause
   - Seek to specific time
   - Zoom in/out timeline
5. Split video clip at playhead
6. Delete segment
7. Undo/redo operations
```

#### Why Critical:
- Tests multi-track timeline functionality
- Validates media compatibility
- Ensures timeline manipulation works
- Tests undo/redo system integrity

---

### 3. 🎨 **Sticker and Text Overlay System**
**Priority**: HIGH  
**Estimated Time**: 20-25 minutes  
**Coverage**: Overlay system and real-time preview

#### Test Scenario:
```typescript
// Path: apps/web/src/test/e2e/overlays.e2e.ts
1. Add video to timeline
2. Open stickers panel
3. Add animated sticker:
   - Position on canvas
   - Resize sticker
   - Set duration (5 seconds)
4. Add text overlay:
   - Enter text "Test Title"
   - Change font size
   - Position text
   - Set animation (fade in)
5. Preview with overlays
6. Export with overlays
7. Verify overlays in output
```

#### Why Critical:
- Tests canvas-based overlay system
- Validates real-time preview
- Ensures overlay persistence in exports
- Tests animation system

---

### 4. 🤖 **AI Features Integration (Transcription & Enhancement)**
**Priority**: HIGH  
**Estimated Time**: 25-30 minutes  
**Coverage**: AI services and API integration

#### Test Scenario:
```typescript
// Path: apps/web/src/test/e2e/ai-features.e2e.ts
1. Import video with speech
2. Generate transcription:
   - Select transcription service
   - Process video
   - Verify subtitles generated
3. Edit subtitles:
   - Modify text
   - Adjust timing
4. Apply AI enhancement:
   - Select enhancement type
   - Process segment
   - Preview enhanced result
5. Export with subtitles
6. Verify subtitle track in output
```

#### Why Critical:
- Tests Electron IPC for AI services
- Validates API key management
- Ensures subtitle workflow works
- Tests AI enhancement pipeline

---

### 5. 🔄 **Cross-Platform File Handling and Storage**
**Priority**: HIGH  
**Estimated Time**: 15-20 minutes  
**Coverage**: Electron file system and storage layers

#### Test Scenario:
```typescript
// Path: apps/web/src/test/e2e/file-storage.e2e.ts
1. Test file operations:
   - Open file dialog
   - Select large video (>100MB)
   - Verify thumbnail generation
2. Test storage fallback:
   - Fill IndexedDB quota
   - Verify fallback to localStorage
3. Test auto-save:
   - Make timeline changes
   - Wait for auto-save
   - Force quit application
   - Reopen and verify recovery
4. Test export locations:
   - Export to custom directory
   - Export with special characters in name
   - Verify file permissions
```

#### Why Critical:
- Tests Electron file system integration
- Validates storage layer resilience
- Ensures data recovery works
- Tests cross-platform compatibility

---

## Implementation Guidelines

### Test Environment Setup
```typescript
// Base E2E test configuration
import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';

test.describe('QCut E2E Tests', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    // Launch Electron app
    app = await electron.launch({
      args: ['dist/electron/main.js'],
      env: { NODE_ENV: 'test' }
    });
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    await app.close();
  });
});
```

### Key Testing Considerations

1. **Test Data Management**
   - Use small test media files (< 10MB)
   - Clean up generated files after tests
   - Use consistent test project names

2. **Timing and Waits**
   - Account for FFmpeg processing time
   - Wait for IndexedDB operations
   - Handle async timeline updates

3. **Platform Differences**
   - Test on Windows, macOS, Linux
   - Handle path separator differences
   - Account for codec availability

4. **Error Scenarios**
   - Test with corrupted media files
   - Test storage quota exceeded
   - Test network failures for AI features

## Success Metrics

### Coverage Goals
- **User Workflows**: 100% of critical paths
- **Feature Integration**: All major features tested
- **Error Handling**: Common failure scenarios covered
- **Performance**: Export times within acceptable range

### Quality Indicators
- Tests run in < 5 minutes total
- Zero flaky tests
- Clear failure messages
- Reproducible across platforms

## Detailed Integration Plan

### Phase 1: Setup & Infrastructure (Week 1)

#### Files to Create/Modify:

**Package Configuration:**
- `qcut/package.json` - Add Playwright dependencies and test scripts
- `qcut/apps/web/package.json` - Add e2e test scripts
- `qcut/playwright.config.ts` - Main Playwright configuration for Electron

**Test Infrastructure:**
- `qcut/apps/web/src/test/e2e/` - Create E2E test directory structure
- `qcut/apps/web/src/test/e2e/fixtures/` - Test media files and project templates
- `qcut/apps/web/src/test/e2e/helpers/` - Utility functions and test helpers
- `qcut/apps/web/src/test/e2e/setup/` - Global test setup and teardown

**Configuration Files:**
- `qcut/apps/web/src/test/e2e/setup/global-setup.ts` - Global test environment setup
- `qcut/apps/web/src/test/e2e/setup/global-teardown.ts` - Cleanup after tests
- `qcut/apps/web/src/test/e2e/helpers/electron-helpers.ts` - Electron-specific utilities
- `qcut/apps/web/src/test/e2e/helpers/media-helpers.ts` - Media file handling utilities

### Phase 2: Core Test Implementation (Weeks 2-3)

#### Test Files to Create:

**Critical Priority Tests:**
- `qcut/apps/web/src/test/e2e/project-workflow.e2e.ts` - Complete video project workflow
- `qcut/apps/web/src/test/e2e/media-timeline.e2e.ts` - Multi-media import and timeline management

**High Priority Tests:**
- `qcut/apps/web/src/test/e2e/overlays.e2e.ts` - Sticker and text overlay system
- `qcut/apps/web/src/test/e2e/ai-features.e2e.ts` - AI features integration
- `qcut/apps/web/src/test/e2e/file-storage.e2e.ts` - Cross-platform file handling

#### Test Fixtures to Create:
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-video.mp4` - Small test video (5MB)
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-audio.mp3` - Test audio file (1MB)
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-image.png` - Test image (500KB)
- `qcut/apps/web/src/test/e2e/fixtures/projects/basic-project.json` - Template project
- `qcut/apps/web/src/test/e2e/fixtures/projects/multi-track-project.json` - Complex project template

### Phase 3: CI/CD Integration (Week 4)

#### Files to Modify/Create:

**GitHub Actions:**
- `.github/workflows/e2e-tests.yml` - E2E test workflow for CI/CD
- `.github/workflows/pr-validation.yml` - Update to include E2E tests

**Build Configuration:**
- `qcut/turbo.json` - Add e2e test task to Turborepo config
- `qcut/.gitignore` - Add E2E test artifacts to ignore list

### Detailed File Structure:

```
qcut/
├── playwright.config.ts                           # Main Playwright config
├── package.json                                   # Add Playwright deps
├── apps/web/
│   ├── package.json                              # Add e2e scripts
│   └── src/test/e2e/
│       ├── setup/
│       │   ├── global-setup.ts                   # Global test setup
│       │   └── global-teardown.ts                # Global cleanup
│       ├── helpers/
│       │   ├── electron-helpers.ts               # Electron utilities
│       │   ├── media-helpers.ts                  # Media utilities
│       │   ├── timeline-helpers.ts               # Timeline utilities
│       │   ├── project-helpers.ts                # Project utilities
│       │   └── assertion-helpers.ts              # Custom assertions
│       ├── fixtures/
│       │   ├── media/
│       │   │   ├── sample-video.mp4             # Test video file
│       │   │   ├── sample-audio.mp3             # Test audio file
│       │   │   └── sample-image.png             # Test image file
│       │   └── projects/
│       │       ├── basic-project.json           # Basic project template
│       │       └── multi-track-project.json     # Complex project template
│       ├── project-workflow.e2e.ts              # Test 1: Complete workflow
│       ├── media-timeline.e2e.ts                # Test 2: Media & timeline
│       ├── overlays.e2e.ts                      # Test 3: Stickers & text
│       ├── ai-features.e2e.ts                   # Test 4: AI integration
│       └── file-storage.e2e.ts                  # Test 5: File handling
├── .github/workflows/
│   ├── e2e-tests.yml                            # E2E CI workflow
│   └── pr-validation.yml                        # Update for E2E
└── turbo.json                                    # Add e2e task
```

### Implementation Schedule:

**Week 1: Infrastructure Setup**
1. Install Playwright dependencies
2. Create configuration files
3. Set up test directory structure
4. Create helper utilities
5. Add test fixtures

**Week 2: Critical Tests**
1. Implement project-workflow.e2e.ts
2. Implement media-timeline.e2e.ts
3. Create supporting test helpers
4. Validate tests work locally

**Week 3: High Priority Tests**
1. Implement overlays.e2e.ts
2. Implement ai-features.e2e.ts
3. Implement file-storage.e2e.ts
4. Refine test helpers and utilities

**Week 4: CI/CD Integration**
1. Create GitHub Actions workflows
2. Configure test reporting
3. Set up failure notifications
4. Test full CI/CD pipeline

### Dependencies to Add:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "playwright": "^1.40.0",
    "playwright-electron": "^0.4.0"
  }
}
```

### Configuration Requirements:

**Environment Variables:**
- `E2E_TEST_TIMEOUT` - Test timeout configuration
- `E2E_FIXTURES_PATH` - Path to test fixtures
- `E2E_OUTPUT_PATH` - Path for test outputs

**Component Updates:**
- Add `data-testid` attributes to key UI components
- Ensure consistent element selectors
- Add test-specific environment detection

## Next Steps

1. **Set up Playwright for Electron**
   ```bash
   bun add -D @playwright/test playwright playwright-electron
   ```

2. **Create test fixtures and helpers**
   - Media file fixtures
   - Project templates
   - Utility functions

3. **Implement tests in priority order**
   - Start with Project Workflow
   - Add remaining tests incrementally

4. **Integrate with CI/CD**
   - Run on PR creation
   - Generate test reports
   - Block merge on failures

## Notes

- These E2E tests complement the existing unit and integration tests
- Focus on user-visible functionality rather than implementation details
- Each test should be independent and not rely on others
- Use data-testid attributes for reliable element selection
- Consider visual regression testing for UI consistency

---

**For questions or updates**: Contact the QA team or refer to the main testing strategy document.