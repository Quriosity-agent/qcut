# Top 5 E2E Test Errors - QCut Playwright Tests

**Last Updated**: 2025-10-23
**Test Framework**: Playwright 1.55.0
**Test Location**: `qcut/apps/web/src/test/e2e/`

---

## Summary

This document identifies the top 5 critical errors preventing E2E tests from running successfully in the QCut video editor project. All tests are currently blocked by Error #1, which must be fixed before other issues can be addressed.

**Current Status**: All tests failing due to critical syntax error in test helpers

---

## Error #1: Destructuring Pattern Required in Playwright Fixture (CRITICAL)

**Severity**: Critical - Blocks ALL tests from running
**Impact**: 100% of test suite fails to execute
**Status**: Unresolved

### Error Message
```
First argument must use the object destructuring pattern: _
```

### Location
**File**: `apps/web/src/test/e2e/helpers/electron-helpers.ts`
**Line**: 29-30

### Description
The Playwright `test.extend()` API requires the first parameter to use object destructuring pattern instead of the underscore placeholder (`_`). This is a breaking change in recent Playwright versions that enforces proper parameter destructuring.

### Current Code (Line 29-30)
```typescript
export const test = base.extend<ElectronFixtures>({
  electronApp: async (_, use) => {
    // Launch Electron app
    const electronApp = await electron.launch({
```

### Fix Required
Replace the underscore `_` with an empty destructuring pattern `{}`:

```typescript
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {  // Change _ to {}
    // Launch Electron app
    const electronApp = await electron.launch({
```

### Fix Subtasks

#### Subtask 1.1: Update electronApp fixture (2 min)
**File**: `apps/web/src/test/e2e/helpers/electron-helpers.ts:30`

**Action**: Replace underscore with empty object destructuring
```bash
# Open the file
code apps/web/src/test/e2e/helpers/electron-helpers.ts
```

**Change**:
```typescript
// Line 30: FROM
  electronApp: async (_, use) => {

// TO
  electronApp: async ({}, use) => {
```

#### Subtask 1.2: Verify no other fixture uses underscore (3 min)
**File**: `apps/web/src/test/e2e/helpers/electron-helpers.ts`

**Search for other occurrences**:
```bash
cd qcut
grep -n "async (_, use)" apps/web/src/test/e2e/helpers/electron-helpers.ts
```

**Expected**: Only line 30 should appear (already fixed in 1.1)

If found elsewhere, apply the same fix: `(_, use)` → `({}, use)`

#### Subtask 1.3: Run simple navigation test to verify fix (2 min)
```bash
cd qcut
bun x playwright test simple-navigation.e2e.ts --project=electron
```

**Expected output**: Test should load without syntax errors and execute
**Success criteria**: No "First argument must use the object destructuring pattern" error

#### Subtask 1.4: Run full test suite to confirm (3 min)
```bash
cd qcut
bun x playwright test --project=electron --reporter=list
```

**Expected**: All tests should at least start executing (may have other failures)
**Success criteria**: Syntax error is completely resolved

**Total time**: ~10 minutes

### References
- Playwright Fixtures Documentation: https://playwright.dev/docs/test-fixtures
- E2E Testing Guide: `qcut/docs/technical/e2e-testing-guide.md` (Section: Best Practices)
- File path: `qcut/apps/web/src/test/e2e/helpers/electron-helpers.ts:29`

---

## Error #2: Excessive Use of `waitForTimeout` (Anti-Pattern)

**Severity**: High - Causes flaky tests and slow execution
**Impact**: 60+ occurrences across 8+ test files
**Status**: Needs refactoring

### Description
The test suite extensively uses `page.waitForTimeout()` which is considered an anti-pattern in Playwright testing. This causes:
- Flaky test results (timing-dependent failures)
- Unnecessarily slow test execution
- Poor reliability across different environments

### Affected Files
1. `ai-transcription-caption-generation.e2e.ts` - 22 occurrences
2. `auto-save-export-file-management.e2e.ts` - 26 occurrences
3. `file-operations-storage-management.e2e.ts` - 9 occurrences
4. `multi-media-management-part1.e2e.ts` - 2 occurrences
5. `multi-media-management-part2.e2e.ts` - 3 occurrences
6. `text-overlay-testing.e2e.ts` - 3 occurrences
7. `helpers/electron-helpers.ts` - 1 occurrence
8. `simple-navigation.e2e.ts` - 1 occurrence

### Examples of Issues

**Example 1** - `ai-transcription-caption-generation.e2e.ts:93`
```typescript
await page.waitForTimeout(3000); // Wait for transcription processing
```

**Example 2** - `auto-save-export-file-management.e2e.ts:640`
```typescript
await page.waitForTimeout(5000);
```

### Recommended Fix
Replace `waitForTimeout` with deterministic waits:

**Instead of:**
```typescript
await page.waitForTimeout(3000);
```

**Use:**
```typescript
// Wait for specific element/state
await page.waitForSelector('[data-testid="transcription-complete"]', { timeout: 10000 });

// Or wait for network idle
await page.waitForLoadState('networkidle');

// Or wait for specific function to return true
await page.waitForFunction(() => window.myApp.isReady);
```

### Files to Modify
- `apps/web/src/test/e2e/ai-transcription-caption-generation.e2e.ts` (22 instances)
- `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` (26 instances)
- `apps/web/src/test/e2e/file-operations-storage-management.e2e.ts` (9 instances)
- All other files listed above

### Fix Subtasks

#### Subtask 2.1: Create waitForTimeout replacement reference guide (10 min)
**File**: Create `apps/web/src/test/e2e/helpers/WAITING-PATTERNS.md`

**Action**: Document common replacement patterns based on e2e-testing-guide.md best practices

**Content to include**:
```markdown
# Waiting Patterns - Replace waitForTimeout

## Common Patterns

### 1. Wait for Element to Appear
❌ await page.waitForTimeout(3000);
✅ await page.waitForSelector('[data-testid="element"]', { timeout: 10000 });

### 2. Wait for Network to Settle
❌ await page.waitForTimeout(2000);
✅ await page.waitForLoadState('networkidle', { timeout: 10000 });

### 3. Wait for State Change
❌ await page.waitForTimeout(1000);
✅ await page.waitForFunction(() => window.appState.isReady, { timeout: 5000 });

### 4. Wait for Media Upload
❌ await page.waitForTimeout(5000);
✅ await page.waitForSelector('text=sample-', { timeout: 15000 });

### 5. Wait for Modal to Close
❌ await page.waitForTimeout(500);
✅ await page.waitForSelector('[data-testid="modal"]', { state: 'hidden', timeout: 5000 });
```

#### Subtask 2.2: Fix helpers/electron-helpers.ts (5 min)
**File**: `apps/web/src/test/e2e/helpers/electron-helpers.ts:175`

**Current code**:
```typescript
await page.waitForTimeout(1000);
```

**Replace with**:
```typescript
// Wait for project buttons to be in DOM
await page.waitForSelector(
  '[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"]',
  { state: "attached", timeout: 2000 }
);
```

**Verify**:
```bash
cd qcut
grep -n "waitForTimeout" apps/web/src/test/e2e/helpers/electron-helpers.ts
# Should return no results after fix
```

#### Subtask 2.3: Fix simple-navigation.e2e.ts (5 min)
**File**: `apps/web/src/test/e2e/simple-navigation.e2e.ts:86`

**Current code**:
```typescript
await page.waitForTimeout(2000);
```

**Replace with**:
```typescript
// Wait for projects page to be stable after route interception
await page.waitForLoadState('networkidle', { timeout: 5000 });
```

**Test the fix**:
```bash
cd qcut
bun x playwright test simple-navigation.e2e.ts --project=electron
```

#### Subtask 2.4: Fix multi-media-management tests (Priority) (30 min)
**Files**:
- `apps/web/src/test/e2e/multi-media-management-part1.e2e.ts` (2 instances)
- `apps/web/src/test/e2e/multi-media-management-part2.e2e.ts` (3 instances)

**Strategy**: Replace each timeout with appropriate deterministic wait

**Common replacements**:
```typescript
// Line part1:83 - After media import
❌ await page.waitForTimeout(1000);
✅ await page.waitForSelector('[data-testid="media-item"]', { state: 'visible', timeout: 5000 });

// Line part1:140 - After user interaction
❌ await page.waitForTimeout(500);
✅ await page.waitForLoadState('domcontentloaded');

// Line part2:48, 55 - Very short waits
❌ await page.waitForTimeout(100);
✅ await page.waitForSelector('[data-testid="expected-element"]', { timeout: 2000 });

// Line part2:134 - After interaction
❌ await page.waitForTimeout(500);
✅ await page.waitForLoadState('networkidle', { timeout: 3000 });
```

**Test after each file**:
```bash
cd qcut
bun x playwright test multi-media-management-part1.e2e.ts --project=electron
bun x playwright test multi-media-management-part2.e2e.ts --project=electron
```

#### Subtask 2.5: Fix text-overlay-testing.e2e.ts (15 min)
**File**: `apps/web/src/test/e2e/text-overlay-testing.e2e.ts` (3 instances)

**Lines 72, 76**: After adding text overlays
```typescript
❌ await page.waitForTimeout(1000);
✅ await page.waitForSelector('[data-testid="text-overlay-added"]', { timeout: 5000 });
// OR if no specific indicator:
✅ await page.waitForLoadState('networkidle', { timeout: 3000 });
```

**Line 192**: After interaction
```typescript
❌ await page.waitForTimeout(200);
✅ await page.waitForFunction(() => document.querySelector('[data-testid="overlay-ready"]') !== null, { timeout: 2000 });
```

**Test**:
```bash
cd qcut
bun x playwright test text-overlay-testing.e2e.ts --project=electron
```

#### Subtask 2.6: Fix file-operations-storage-management.e2e.ts (20 min)
**File**: `apps/web/src/test/e2e/file-operations-storage-management.e2e.ts` (9 instances)

**Pattern identification**:
```bash
cd qcut
grep -n "waitForTimeout" apps/web/src/test/e2e/file-operations-storage-management.e2e.ts
```

**Common replacements based on context**:
```typescript
// After file operations
❌ await page.waitForTimeout(1000);
✅ await page.waitForSelector('[data-testid="file-loaded"]', { timeout: 5000 });

// After save operations
❌ await page.waitForTimeout(2000);
✅ await page.waitForFunction(() => window.electronAPI?.storage?.lastSaveTime > 0, { timeout: 5000 });

// Small delays for user interaction
❌ await page.waitForTimeout(500);
✅ await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
```

**Test**:
```bash
cd qcut
bun x playwright test file-operations-storage-management.e2e.ts --project=electron
```

#### Subtask 2.7: Fix auto-save-export-file-management.e2e.ts (LARGEST - 60 min)
**File**: `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` (26 instances)

**Phase 1: Categorize timeouts** (10 min)
```bash
cd qcut
grep -B2 -A2 "waitForTimeout" apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts > /tmp/timeout-context.txt
# Review context for each timeout
```

**Phase 2: Replace by category** (40 min)

**Category A: After auto-save operations** (Lines 124, 552, 556)
```typescript
❌ await page.waitForTimeout(2000);
✅ await page.waitForFunction(
  () => window.electronAPI?.autoSave?.lastSaveTime > 0,
  { timeout: 5000 }
);
```

**Category B: After export operations** (Lines 393, 640, 647)
```typescript
❌ await page.waitForTimeout(3000);
❌ await page.waitForTimeout(5000);
✅ await page.waitForSelector('[data-testid="export-complete"]', { timeout: 15000 });
// OR wait for export progress indicator to disappear
✅ await page.waitForSelector('[data-testid="export-progress"]', { state: 'hidden', timeout: 15000 });
```

**Category C: Small interaction delays** (Lines 111, 279, 288, etc.)
```typescript
❌ await page.waitForTimeout(500);
❌ await page.waitForTimeout(1000);
✅ await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
```

**Phase 3: Test incrementally** (10 min)
```bash
cd qcut
# Test after every 5-8 replacements
bun x playwright test auto-save-export-file-management.e2e.ts --project=electron --headed
```

#### Subtask 2.8: Fix ai-transcription-caption-generation.e2e.ts (40 min)
**File**: `apps/web/src/test/e2e/ai-transcription-caption-generation.e2e.ts` (22 instances)

**Phase 1: Identify AI operation timeouts** (5 min)
```bash
cd qcut
grep -n "waitForTimeout(3000)" apps/web/src/test/e2e/ai-transcription-caption-generation.e2e.ts
# Lines 69, 93, 135, 179, 204, 231 - All AI processing waits
```

**Phase 2: Replace AI processing waits** (20 min)
```typescript
❌ await page.waitForTimeout(3000); // Wait for transcription processing
✅ await page.waitForSelector('[data-testid="transcription-complete"]', { timeout: 10000 });
// OR check for progress indicator
✅ await page.waitForSelector('[data-testid="ai-processing"]', { state: 'hidden', timeout: 10000 });
// OR use state function
✅ await page.waitForFunction(
  () => !document.querySelector('[data-testid="ai-loading"]'),
  { timeout: 10000 }
);
```

**Phase 3: Replace UI interaction delays** (10 min)
```typescript
// Lines 42, 58, 86, 104, etc. - Small UI delays
❌ await page.waitForTimeout(500);
✅ await page.waitForLoadState('networkidle', { timeout: 2000 });
```

**Phase 4: Replace modal waits** (Lines 113, 145, 188, 240, 279)
```typescript
❌ await page.waitForTimeout(1000);
❌ await page.waitForTimeout(2000);
✅ await page.waitForSelector('[data-testid="caption-modal"]', { state: 'visible', timeout: 3000 });
// Or wait for modal to close
✅ await page.waitForSelector('[data-testid="modal-overlay"]', { state: 'hidden', timeout: 3000 });
```

**Test**:
```bash
cd qcut
bun x playwright test ai-transcription-caption-generation.e2e.ts --project=electron --reporter=list
```

#### Subtask 2.9: Verify all changes with full test run (10 min)
```bash
cd qcut
# Run full suite to ensure no regressions
bun x playwright test --project=electron --reporter=html

# Check for any remaining waitForTimeout
grep -r "waitForTimeout" apps/web/src/test/e2e/ --include="*.e2e.ts"
# Should only show commented examples or none
```

#### Subtask 2.10: Update e2e-testing-guide.md with new patterns (5 min)
**File**: `docs/technical/e2e-testing-guide.md`

**Add section** (after line 264):
```markdown
### 5. Common waitForTimeout Replacements

See `apps/web/src/test/e2e/helpers/WAITING-PATTERNS.md` for comprehensive patterns.

Quick reference:
- ✅ Use `waitForSelector()` for element appearance/disappearance
- ✅ Use `waitForLoadState()` for page/network state
- ✅ Use `waitForFunction()` for custom conditions
- ❌ Avoid `waitForTimeout()` - causes flaky tests
```

**Total time**: ~3-4 hours (can be split across multiple sessions)
**Recommended approach**: Fix in order 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8

### References
- E2E Testing Guide: `qcut/docs/technical/e2e-testing-guide.md` (Section: Best Practices → Waiting Strategies, lines 256-264)
- Playwright Waiting: https://playwright.dev/docs/actionability
- Anti-patterns: https://playwright.dev/docs/best-practices#use-web-first-assertions

---

## Error #3: Incorrect `test.skip()` Usage

**Severity**: Medium - Causes runtime errors in specific test cases
**Impact**: 1 test file affected
**Status**: Needs fix

### Location
**File**: `apps/web/src/test/e2e/editor-navigation.e2e.ts`
**Line**: 39

### Description
The test attempts to conditionally skip a test by calling `test.skip()` inside the test body, which is not the correct pattern. This should use conditional test execution or `test.skip()` with a condition callback.

### Current Code (Line 30-41)
```typescript
test("should attempt to open existing project without crash", async ({
  page,
}) => {
  // Check if there are existing projects
  const projectCards = page.getByTestId("project-list-item");
  const projectCount = await projectCards.count();

  if (projectCount === 0) {
    console.log("No existing projects to test with");
    test.skip();  // INCORRECT USAGE
    return;
  }
```

### Recommended Fix

**Option 1: Use test.skip with condition**
```typescript
test.skip(({ projectCount }) => projectCount === 0, "should attempt to open existing project without crash", async ({ page }) => {
  // test body
});
```

**Option 2: Use dynamic test execution**
```typescript
test("should attempt to open existing project without crash", async ({ page }) => {
  const projectCards = page.getByTestId("project-list-item");
  const projectCount = await projectCards.count();

  test.skip(projectCount === 0, "No existing projects to test with");

  // Rest of test continues only if not skipped
});
```

### File to Modify
- `apps/web/src/test/e2e/editor-navigation.e2e.ts:39`

### Fix Subtasks

#### Subtask 3.1: Update test.skip() usage in editor-navigation.e2e.ts (5 min)
**File**: `apps/web/src/test/e2e/editor-navigation.e2e.ts:30-41`

**Current code**:
```typescript
test("should attempt to open existing project without crash", async ({
  page,
}) => {
  // Check if there are existing projects
  const projectCards = page.getByTestId("project-list-item");
  const projectCount = await projectCards.count();

  if (projectCount === 0) {
    console.log("No existing projects to test with");
    test.skip();  // INCORRECT
    return;
  }
```

**Replace with**:
```typescript
test("should attempt to open existing project without crash", async ({
  page,
}) => {
  // Check if there are existing projects
  const projectCards = page.getByTestId("project-list-item");
  const projectCount = await projectCards.count();

  // Properly skip test if no projects exist
  test.skip(projectCount === 0, "No existing projects to test with");

  // Rest of test continues only if not skipped
```

**Key change**: Move `test.skip()` to single line with condition and message

#### Subtask 3.2: Verify the fix works (5 min)
```bash
cd qcut
# Test with no projects (will skip gracefully)
bun x playwright test editor-navigation.e2e.ts --project=electron --grep "should attempt to open"
```

**Expected behavior**:
- If no projects: Test skipped with message "No existing projects to test with"
- If projects exist: Test executes normally

#### Subtask 3.3: Check for similar patterns in other files (5 min)
```bash
cd qcut
# Search for other incorrect test.skip() usage
grep -rn "test.skip()" apps/web/src/test/e2e/ --include="*.e2e.ts" -A1 -B1
```

**Action**: If found, apply same pattern fix
**Expected**: Only the fixed file should appear

**Total time**: ~15 minutes

### References
- Playwright test.skip() API: https://playwright.dev/docs/api/class-test#test-skip
- E2E Testing Guide: `qcut/docs/technical/e2e-testing-guide.md` (Section: Test Architecture)

---

## Error #4: Potential Missing Test Fixtures

**Severity**: Medium - Tests may fail if fixtures are missing
**Impact**: All tests that import media files
**Status**: Needs verification

### Description
Many tests reference media files in the `apps/web/src/test/e2e/fixtures/media/` directory, but it's unclear if these files exist or are properly configured in the repository.

### Expected Fixture Files
Based on helper functions, these files should exist:
1. `sample-video.mp4` - 5-second 720p test video
2. `sample-audio.mp3` - 5-second sine wave test audio
3. `sample-image.png` - 1280x720 blue test image

### Referenced in Helper Functions
**File**: `apps/web/src/test/e2e/helpers/electron-helpers.ts`
- Line 15-16: `mediaPath()` function
- Line 252-255: `importTestVideo()`
- Line 264-267: `importTestAudio()`
- Line 276-279: `importTestImage()`

### Action Required
1. Verify these fixture files exist at: `qcut/apps/web/src/test/e2e/fixtures/media/`
2. Ensure files are committed to git or documented in setup instructions
3. Create missing fixture files with appropriate test media
4. Consider adding `.gitattributes` for LFS if files are large

### Files to Check
- `apps/web/src/test/e2e/fixtures/media/sample-video.mp4`
- `apps/web/src/test/e2e/fixtures/media/sample-audio.mp3`
- `apps/web/src/test/e2e/fixtures/media/sample-image.png`

### Fix Subtasks

#### Subtask 4.1: Verify fixtures directory exists (2 min)
```bash
cd qcut
ls -la apps/web/src/test/e2e/fixtures/media/
```

**Expected**: Directory should exist
**If not**: Create it
```bash
mkdir -p apps/web/src/test/e2e/fixtures/media
```

#### Subtask 4.2: Check for existing fixture files (3 min)
```bash
cd qcut
ls -lh apps/web/src/test/e2e/fixtures/media/
```

**Expected files**:
- `sample-video.mp4` (5-second, 720p video)
- `sample-audio.mp3` (5-second sine wave audio)
- `sample-image.png` (1280x720 blue image)

**Document status**:
```bash
# Create a verification file
cat > apps/web/src/test/e2e/fixtures/media/README.md << 'EOF'
# Test Media Fixtures

## Required Files
- sample-video.mp4: 5-second 720p test video
- sample-audio.mp3: 5-second sine wave audio
- sample-image.png: 1280x720 blue test image

## Status
Check this file for fixture availability status.
EOF
```

#### Subtask 4.3: Create sample-video.mp4 using FFmpeg (10 min)
**Requirement**: 5-second, 720p video with recognizable pattern

```bash
cd qcut/apps/web/src/test/e2e/fixtures/media

# Create 5-second 720p test video with color bars and timecode
ffmpeg -f lavfi -i testsrc=duration=5:size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=5 \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 128k \
  sample-video.mp4
```

**Verify creation**:
```bash
ffmpeg -i sample-video.mp4
# Should show: 1280x720, 30fps, ~5 seconds duration
```

**Alternative if FFmpeg not available**: Download from test resources
```bash
# Create placeholder documentation
echo "Generate using: bun run generate-test-fixtures" > GENERATE.md
```

#### Subtask 4.4: Create sample-audio.mp3 using FFmpeg (5 min)
**Requirement**: 5-second sine wave audio

```bash
cd qcut/apps/web/src/test/e2e/fixtures/media

# Create 5-second sine wave audio at 440Hz (A4 note)
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
  -c:a libmp3lame -b:a 128k \
  sample-audio.mp3
```

**Verify creation**:
```bash
ffmpeg -i sample-audio.mp3
# Should show: ~5 seconds duration, audio stream
```

#### Subtask 4.5: Create sample-image.png using ImageMagick or Node.js (5 min)
**Requirement**: 1280x720 blue test image

**Option A: Using ImageMagick**
```bash
cd qcut/apps/web/src/test/e2e/fixtures/media

# Create 1280x720 blue image with text
convert -size 1280x720 xc:blue \
  -pointsize 72 -fill white -gravity center \
  -annotate +0+0 "Test Image\n1280x720" \
  sample-image.png
```

**Option B: Using Node.js (if ImageMagick not available)**
```bash
cd qcut/apps/web/src/test/e2e/fixtures/media

# Create image generator script
cat > generate-image.js << 'EOF'
const fs = require('fs');
const { createCanvas } = require('canvas');

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');

// Blue background
ctx.fillStyle = '#0000FF';
ctx.fillRect(0, 0, 1280, 720);

// White text
ctx.fillStyle = '#FFFFFF';
ctx.font = '72px Arial';
ctx.textAlign = 'center';
ctx.fillText('Test Image', 640, 320);
ctx.fillText('1280x720', 640, 420);

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('sample-image.png', buffer);
console.log('Created sample-image.png');
EOF

# Install canvas if needed
bun add canvas

# Generate image
node generate-image.js

# Clean up
rm generate-image.js
```

**Verify creation**:
```bash
file sample-image.png
# Should show: PNG image data, 1280 x 720
```

#### Subtask 4.6: Add fixtures to git (if appropriate) (5 min)
**Decision point**: Should fixtures be committed or generated?

**Option A: Commit fixtures** (Recommended for small files)
```bash
cd qcut

# Check file sizes
ls -lh apps/web/src/test/e2e/fixtures/media/

# If all files < 1MB total, add to git
git add apps/web/src/test/e2e/fixtures/media/
git commit -m "test: add E2E test media fixtures

- sample-video.mp4: 5s 720p test video
- sample-audio.mp3: 5s sine wave audio
- sample-image.png: 1280x720 blue test image"
```

**Option B: Generate on setup** (For larger files)
```bash
cd qcut

# Create generation script
cat > apps/web/src/test/e2e/fixtures/generate-fixtures.sh << 'EOF'
#!/bin/bash
# Generate E2E test fixtures

FIXTURE_DIR="media"
cd "$(dirname "$0")/$FIXTURE_DIR"

echo "Generating test fixtures..."

# Video
ffmpeg -f lavfi -i testsrc=duration=5:size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=5 \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 128k sample-video.mp4 -y

# Audio
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
  -c:a libmp3lame -b:a 128k sample-audio.mp3 -y

# Image (requires ImageMagick)
convert -size 1280x720 xc:blue \
  -pointsize 72 -fill white -gravity center \
  -annotate +0+0 "Test Image\n1280x720" sample-image.png

echo "Fixtures generated successfully"
EOF

chmod +x apps/web/src/test/e2e/fixtures/generate-fixtures.sh

# Add to .gitignore
echo "apps/web/src/test/e2e/fixtures/media/*.mp4" >> .gitignore
echo "apps/web/src/test/e2e/fixtures/media/*.mp3" >> .gitignore
echo "apps/web/src/test/e2e/fixtures/media/*.png" >> .gitignore
```

#### Subtask 4.7: Update e2e-testing-guide.md with fixture setup (5 min)
**File**: `docs/technical/e2e-testing-guide.md`

**Add to Prerequisites section** (after line 10):
```markdown
3. **Generate test fixtures** (if not committed):
   ```bash
   cd qcut/apps/web/src/test/e2e/fixtures
   bash generate-fixtures.sh
   # OR verify fixtures exist:
   ls -la media/
   ```
```

#### Subtask 4.8: Verify fixtures work in tests (5 min)
```bash
cd qcut

# Run a test that uses media imports
bun x playwright test project-workflow-part1.e2e.ts --project=electron --grep "should create project and import media"
```

**Expected**: Test should successfully import media files
**If fails**: Check file paths in electron-helpers.ts `mediaPath()` function

#### Subtask 4.9: Document fixture requirements (3 min)
**File**: `apps/web/src/test/e2e/fixtures/media/README.md`

```markdown
# E2E Test Media Fixtures

## Required Files

### sample-video.mp4
- Duration: 5 seconds
- Resolution: 1280x720 (720p)
- Frame rate: 30fps
- Codec: H.264
- Audio: AAC, 128kbps
- Purpose: Video import and timeline tests

### sample-audio.mp3
- Duration: 5 seconds
- Format: MP3, 128kbps
- Frequency: 440Hz sine wave (A4 note)
- Purpose: Audio import and mixing tests

### sample-image.png
- Resolution: 1280x720
- Format: PNG
- Content: Blue background with white text
- Purpose: Image import and overlay tests

## Generation

See `../generate-fixtures.sh` for automated generation.

## Size Limits
- Total fixtures: < 5MB recommended
- Individual files: < 2MB each

## Usage

Fixtures are referenced in `electron-helpers.ts`:
```typescript
const mediaPath = (file: string) =>
  pathResolve(process.cwd(), "apps/web/src/test/e2e/fixtures/media", file);
```
```

**Total time**: ~40-45 minutes (including generation/download time)

### References
- E2E Testing Guide: `qcut/docs/technical/e2e-testing-guide.md` (Section: File Structure, lines 117-126)
- Helper Functions: `apps/web/src/test/e2e/helpers/electron-helpers.ts` (Lines 15-16, 252-279)
- FFmpeg Documentation: https://ffmpeg.org/ffmpeg.html#Syntax

---

## Error #5: Inconsistent Timeout Values and Race Conditions

**Severity**: Medium - Causes flaky tests
**Impact**: Multiple test files
**Status**: Needs standardization

### Description
Tests use inconsistent timeout values and potentially unsafe race conditions, leading to unreliable test execution. Some tests use very short timeouts (500ms, 1000ms) that may fail on slower systems.

### Examples of Issues

**Example 1: Short timeout** - `simple-navigation.e2e.ts:13`
```typescript
await expect(page.getByText("Your Projects")).toBeVisible();  // Uses default timeout
```

**Example 2: Unsafe race condition** - `editor-navigation.e2e.ts:68-71`
```typescript
await Promise.race([
  page.waitForURL(/editor/i, { timeout: 15_000 }),
  editorLocator.waitFor({ state: "visible", timeout: 15_000 }),
]);
```
This race condition may pass even if one of the conditions fails, masking actual issues.

**Example 3: Very short timeout** - `multi-media-management-part2.e2e.ts:48`
```typescript
await page.waitForTimeout(100);  // Too short, should use deterministic wait
```

### Recommended Fixes

**1. Standardize timeout configuration**
```typescript
// In playwright.config.ts
export default defineConfig({
  timeout: 60_000,      // Global test timeout
  expect: {
    timeout: 10_000,    // Assertion timeout
  },
});
```

**2. Use explicit timeouts for critical assertions**
```typescript
await expect(page.getByText("Your Projects")).toBeVisible({ timeout: 10_000 });
```

**3. Replace race conditions with proper waiting**
```typescript
// Instead of Promise.race, wait for specific success condition
try {
  await page.waitForURL(/editor/i, { timeout: 15_000 });
  await editorLocator.waitFor({ state: "visible", timeout: 5_000 });
} catch (error) {
  // Handle timeout appropriately
}
```

### Files to Modify
- `apps/web/src/test/e2e/editor-navigation.e2e.ts` (race conditions)
- `apps/web/src/test/e2e/multi-media-management-part2.e2e.ts` (short timeouts)
- Review all test files for consistent timeout usage

### Fix Subtasks

#### Subtask 5.1: Verify current timeout configuration (5 min)
**File**: `playwright.config.ts`

```bash
cd qcut
cat playwright.config.ts | grep -A5 "timeout"
```

**Current values** (from config):
```typescript
timeout: 60_000,      // 60 seconds - Global test timeout
expect: {
  timeout: 10_000,    // 10 seconds - Assertion timeout
}
```

**Verify these are appropriate**: ✅ Values look good (60s test, 10s assertion)

#### Subtask 5.2: Create timeout standards document (10 min)
**File**: Create `apps/web/src/test/e2e/helpers/TIMEOUT-STANDARDS.md`

**Content**:
```markdown
# E2E Test Timeout Standards

## Global Timeouts (playwright.config.ts)
- Test timeout: 60,000ms (60 seconds)
- Assertion timeout: 10,000ms (10 seconds)
- Action timeout: 5,000ms (implicit via Playwright defaults)

## Recommended Timeout Values by Operation

### Navigation Operations
```typescript
// Page navigation and route changes
await page.waitForURL(/editor/i, { timeout: 15_000 });  // 15s
await page.waitForLoadState('networkidle', { timeout: 10_000 });  // 10s
```

### Element Interactions
```typescript
// Standard element waits
await page.waitForSelector('[data-testid="element"]', { timeout: 10_000 });  // 10s

// Critical UI elements (always present)
await expect(element).toBeVisible({ timeout: 5_000 });  // 5s

// Optional/conditional elements
await element.isVisible({ timeout: 2_000 });  // 2s
```

### Media Operations
```typescript
// Media import/upload
await page.waitForSelector('text=sample-', { timeout: 15_000 });  // 15s

// Video processing
await page.waitForSelector('[data-testid="processing-complete"]', { timeout: 30_000 });  // 30s
```

### AI Operations
```typescript
// AI processing (transcription, enhancement)
await page.waitForSelector('[data-testid="ai-complete"]', { timeout: 20_000 });  // 20s
```

### Export Operations
```typescript
// Video export
await page.waitForSelector('[data-testid="export-complete"]', { timeout: 60_000 });  // 60s
```

## Anti-Patterns

### ❌ Avoid Very Short Timeouts
```typescript
❌ await element.isVisible({ timeout: 100 });   // Too short
✅ await element.isVisible({ timeout: 2_000 });  // Minimum 2s
```

### ❌ Avoid Implicit/Missing Timeouts
```typescript
❌ await expect(element).toBeVisible();  // Uses default, unclear
✅ await expect(element).toBeVisible({ timeout: 5_000 });  // Explicit
```

### ❌ Avoid Promise.race for Success Conditions
```typescript
❌ await Promise.race([condition1, condition2]);  // Can mask failures
✅ await condition1; await condition2;  // Explicit success
```

## Reference
Based on: `docs/technical/e2e-testing-guide.md` and Playwright best practices
```

#### Subtask 5.3: Fix race condition in editor-navigation.e2e.ts (15 min)
**File**: `apps/web/src/test/e2e/editor-navigation.e2e.ts:68-71`

**Current problematic code**:
```typescript
await Promise.race([
  page.waitForURL(/editor/i, { timeout: 15_000 }),
  editorLocator.waitFor({ state: "visible", timeout: 15_000 }),
]);
```

**Problem**: Test passes if EITHER condition succeeds, masking potential issues

**Fix - Option 1: Sequential waits (Recommended)**
```typescript
// Wait for URL to change to editor route
await page.waitForURL(/editor/i, { timeout: 15_000 });

// Then verify editor UI loaded
await editorLocator.waitFor({ state: "visible", timeout: 10_000 });
```

**Fix - Option 2: Promise.all for both conditions**
```typescript
// Both must succeed
await Promise.all([
  page.waitForURL(/editor/i, { timeout: 15_000 }),
  editorLocator.waitFor({ state: "visible", timeout: 15_000 }),
]);
```

**Fix - Option 3: Try-catch with fallback**
```typescript
try {
  // Primary: wait for URL change
  await page.waitForURL(/editor/i, { timeout: 15_000 });

  // Verify editor loaded
  await editorLocator.waitFor({ state: "visible", timeout: 10_000 });
} catch (error) {
  // Log helpful debugging info
  const currentUrl = await page.evaluate(() => window.location.href);
  const editorVisible = await editorLocator.isVisible();
  console.error(`Navigation failed: URL=${currentUrl}, EditorVisible=${editorVisible}`);
  throw error;
}
```

**Apply fix**:
```bash
cd qcut
# Edit file with preferred option (Option 1 recommended)
code apps/web/src/test/e2e/editor-navigation.e2e.ts
```

**Lines to update**: 68-71, and potentially 129-132 (similar pattern)

#### Subtask 5.4: Fix another race condition in editor-navigation.e2e.ts (10 min)
**File**: `apps/web/src/test/e2e/editor-navigation.e2e.ts:129-132`

**Current code**:
```typescript
await Promise.race([
  editorLocator.first().waitFor({ timeout: 10_000 }),
  errorLocator.first().waitFor({ timeout: 10_000 }),
]);
```

**This is acceptable** - waiting for EITHER success OR error state is valid

**Improvement** (optional but recommended):
```typescript
// Wait for either editor or error, with better error context
const result = await Promise.race([
  editorLocator.first().waitFor({ timeout: 10_000 }).then(() => 'editor'),
  errorLocator.first().waitFor({ timeout: 10_000 }).then(() => 'error'),
]);

console.log(`Navigation result: ${result}`);
```

#### Subtask 5.5: Add explicit timeouts to simple-navigation.e2e.ts (10 min)
**File**: `apps/web/src/test/e2e/simple-navigation.e2e.ts`

**Find all implicit timeout assertions**:
```bash
cd qcut
grep -n "toBeVisible()" apps/web/src/test/e2e/simple-navigation.e2e.ts
grep -n "toBeAttached()" apps/web/src/test/e2e/simple-navigation.e2e.ts
grep -n "toBeEnabled()" apps/web/src/test/e2e/simple-navigation.e2e.ts
```

**Update each assertion with explicit timeout**:

**Line 13**:
```typescript
❌ await expect(page.getByText("Your Projects")).toBeVisible();
✅ await expect(page.getByText("Your Projects")).toBeVisible({ timeout: 5_000 });
```

**Lines 24-27**:
```typescript
❌ await expect(page.getByText("No projects yet")).toBeVisible();
❌ await expect(page.getByTestId("new-project-button-empty-state")).toBeVisible();
✅ await expect(page.getByText("No projects yet")).toBeVisible({ timeout: 5_000 });
✅ await expect(page.getByTestId("new-project-button-empty-state")).toBeVisible({ timeout: 5_000 });
```

**Continue for all assertions** in the file

#### Subtask 5.6: Standardize timeouts across all test files (30 min)
**Strategy**: Update all test files to use explicit, standardized timeouts

**Files to update** (in priority order):
1. `simple-navigation.e2e.ts` ✅ (Done in 5.5)
2. `editor-navigation.e2e.ts` ✅ (Done in 5.3-5.4)
3. `project-workflow-part1.e2e.ts`
4. `project-workflow-part2.e2e.ts`
5. `project-workflow-part3.e2e.ts`
6. All feature-specific test files

**For each file**:
```bash
cd qcut

# Find implicit timeout assertions
grep -n "toBeVisible()" apps/web/src/test/e2e/FILENAME.e2e.ts | grep -v "timeout:"

# Update each to include explicit timeout
# Use timeout standards from TIMEOUT-STANDARDS.md:
# - Standard UI: 5_000ms
# - Navigation: 10_000ms
# - Media ops: 15_000ms
# - AI/Export: 20_000-60_000ms
```

**Example replacement patterns**:
```typescript
// Standard UI elements
toBeVisible()  →  toBeVisible({ timeout: 5_000 })
toBeAttached()  →  toBeAttached({ timeout: 5_000 })
toBeEnabled()  →  toBeEnabled({ timeout: 5_000 })

// Navigation elements
page.waitForSelector()  →  page.waitForSelector('[selector]', { timeout: 10_000 })

// Media/AI elements
page.waitForSelector('[data-testid="media-loaded"]')  →
  page.waitForSelector('[data-testid="media-loaded"]', { timeout: 15_000 })
```

#### Subtask 5.7: Create ESLint rule for timeout enforcement (Advanced - 20 min)
**File**: Create `.eslintrc.playwright.js` (optional but recommended)

```javascript
module.exports = {
  overrides: [
    {
      files: ['**/*.e2e.ts'],
      rules: {
        // Custom rule: require explicit timeouts in test assertions
        '@typescript-eslint/explicit-timeout-required': 'warn',

        // Warn on Promise.race in tests (potential race conditions)
        'no-restricted-syntax': [
          'warn',
          {
            selector: 'CallExpression[callee.object.name="Promise"][callee.property.name="race"]',
            message: 'Avoid Promise.race in E2E tests - can mask failures. Use Promise.all or sequential waits.'
          }
        ]
      }
    }
  ]
};
```

**Note**: This requires custom ESLint plugin development. Skip if too complex.

#### Subtask 5.8: Run full test suite with timeout improvements (15 min)
```bash
cd qcut

# Run full suite to verify timeout changes
bun x playwright test --project=electron --reporter=html

# Check for timeout-related failures
bun x playwright show-report docs/completed/test-results

# Look for common timeout issues:
# - Tests timing out (need longer timeouts)
# - Tests passing too quickly (might be skipping waits)
```

**Review results**:
- ✅ All tests using explicit timeouts
- ✅ No Promise.race for success conditions
- ✅ Consistent timeout values based on operation type
- ✅ Tests complete within reasonable time (<5 minutes for full suite)

#### Subtask 5.9: Update e2e-testing-guide.md with timeout standards (10 min)
**File**: `docs/technical/e2e-testing-guide.md`

**Add new section** (after line 291):
```markdown
### 6. Timeout Management

Always use explicit timeouts based on operation type:

```typescript
// Navigation: 10-15s
await page.waitForURL(/route/, { timeout: 15_000 });

// Standard UI: 5s
await expect(element).toBeVisible({ timeout: 5_000 });

// Media operations: 15s
await page.waitForSelector('[data-testid="media-loaded"]', { timeout: 15_000 });

// AI/Export: 20-60s
await page.waitForSelector('[data-testid="export-complete"]', { timeout: 60_000 });
```

**See `apps/web/src/test/e2e/helpers/TIMEOUT-STANDARDS.md` for complete guide.**

### 7. Avoid Race Conditions

```typescript
// ❌ Bad: Race condition masks failures
await Promise.race([condition1, condition2]);

// ✅ Good: Sequential waits
await condition1;
await condition2;

// ✅ Good: Both must succeed
await Promise.all([condition1, condition2]);
```
```

#### Subtask 5.10: Verify and document completion (5 min)
```bash
cd qcut

# Verify no implicit timeouts remain
grep -r "toBeVisible()" apps/web/src/test/e2e/ --include="*.e2e.ts" | grep -v "timeout:" | wc -l
# Should be 0 or very few

# Verify no problematic Promise.race
grep -r "Promise.race" apps/web/src/test/e2e/ --include="*.e2e.ts" -B2 -A2
# Review each for validity

# Create completion report
cat > qcut/docs/issues/e2e-test-errors/ERROR-5-COMPLETION.md << 'EOF'
# Error #5 Fix Completion Report

## Changes Made
- ✅ Added TIMEOUT-STANDARDS.md reference guide
- ✅ Fixed race conditions in editor-navigation.e2e.ts
- ✅ Added explicit timeouts to all test assertions
- ✅ Standardized timeout values by operation type
- ✅ Updated e2e-testing-guide.md with timeout guidelines

## Verification
- All tests using explicit timeouts: [YES/NO]
- No unsafe Promise.race conditions: [YES/NO]
- Test suite completion time: [X minutes]

## Next Steps
- Monitor test stability over next 10 runs
- Adjust timeout values if needed
- Consider adding timeout linting rules
EOF
```

**Total time**: ~2-2.5 hours (can be split across sessions)
**Recommended approach**: Complete subtasks 5.1-5.5 first, then 5.6-5.10

### References
- E2E Testing Guide: `qcut/docs/technical/e2e-testing-guide.md` (Section: Best Practices, lines 250-291)
- Playwright Timeouts: https://playwright.dev/docs/test-timeouts
- Playwright Best Practices: https://playwright.dev/docs/best-practices#avoid-timeout-in-assertions
- Current Config: `qcut/playwright.config.ts:12-14`

---

## Recommended Fix Priority & Time Estimates

### Phase 1: IMMEDIATE (Blocks all tests) - 10 minutes
**Must complete before any tests can run**

1. **Error #1: Fix destructuring pattern**
   - Subtasks: 1.1 - 1.4
   - Time: ~10 minutes
   - Impact: Unblocks entire test suite
   - Files: 1 file (`electron-helpers.ts`)

### Phase 2: HIGH PRIORITY (After Phase 1) - 4-5 hours
**Fixes major test reliability issues**

2. **Error #4: Verify and create missing test fixtures**
   - Subtasks: 4.1 - 4.9
   - Time: ~40-45 minutes
   - Impact: Enables media import tests
   - Files: Create 3 fixture files + documentation

3. **Error #2: Replace `waitForTimeout` anti-pattern**
   - Subtasks: 2.1 - 2.10
   - Time: ~3-4 hours (can split across sessions)
   - Impact: Eliminates flaky tests, improves reliability
   - Files: 8+ test files (67 instances total)
   - **Recommended order**: 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8

### Phase 3: MEDIUM PRIORITY (Polish & Standardization) - 2.5-3 hours
**Improves test quality and consistency**

4. **Error #3: Fix incorrect `test.skip()` usage**
   - Subtasks: 3.1 - 3.3
   - Time: ~15 minutes
   - Impact: Prevents runtime errors in conditional tests
   - Files: 1 file (`editor-navigation.e2e.ts`)

5. **Error #5: Standardize timeouts and fix race conditions**
   - Subtasks: 5.1 - 5.10
   - Time: ~2-2.5 hours (can split across sessions)
   - Impact: Consistent test behavior, no masked failures
   - Files: All test files (~13 files)
   - **Recommended order**: 5.1 → 5.5 → 5.3 → 5.6 → 5.9

### Total Time Estimate
- **Minimum (Phase 1 only)**: 10 minutes → Tests can run
- **Recommended (Phases 1-2)**: ~5 hours → Tests reliable
- **Complete (All phases)**: ~7-8 hours → Production-ready test suite

### Work Session Breakdown
**Session 1 (30 min)**: Phase 1 + Error #3 + Error #4 (verification)
- Fix critical blocker
- Quick wins for visibility

**Session 2 (2 hours)**: Error #4 (fixtures) + Error #2 (helpers + simple tests)
- Create test fixtures
- Start waitForTimeout replacements

**Session 3 (2 hours)**: Error #2 (multi-media + text overlay tests)
- Continue waitForTimeout replacements
- Test incrementally

**Session 4 (2 hours)**: Error #2 (complex tests) + Error #5 (timeout standards)
- Finish waitForTimeout replacements
- Standardize timeout values

**Session 5 (1 hour)**: Error #5 (race conditions) + verification
- Fix race conditions
- Run full test suite
- Document completion

---

## Additional Notes

### Test Environment
- **Node Environment**: test (set via `NODE_ENV`)
- **Electron Configuration**: GPU disabled for consistent testing
- **Workers**: Single worker to avoid port conflicts
- **Parallelization**: Disabled for Electron tests

### Current Test Configuration
From `playwright.config.ts`:
```typescript
{
  testDir: "./apps/web/src/test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["html", { outputFolder: "./docs/completed/test-results" }]],
  outputDir: "./docs/completed/test-results-raw",
}
```

### Running Tests After Fixes
```bash
# From qcut directory
bun x playwright test

# Run specific test file
bun x playwright test simple-navigation.e2e.ts

# View HTML report
npx playwright show-report docs/completed/test-results
```

---

## Related Documentation

- Playwright Best Practices: https://playwright.dev/docs/best-practices
- Playwright Fixtures: https://playwright.dev/docs/test-fixtures
- Playwright Assertions: https://playwright.dev/docs/test-assertions
- Project README: `qcut/CLAUDE.md`
- Playwright Config: `qcut/playwright.config.ts`

---

---

## Summary Table: All Errors & Subtasks

| Error | Severity | Subtasks | Est. Time | Files Affected | Impact |
|-------|----------|----------|-----------|----------------|---------|
| #1: Destructuring Pattern | Critical | 4 | 10 min | 1 | Blocks ALL tests |
| #2: waitForTimeout Anti-pattern | High | 10 | 3-4 hrs | 8+ | Flaky tests |
| #3: test.skip() Usage | Medium | 3 | 15 min | 1 | Runtime errors |
| #4: Missing Fixtures | Medium | 9 | 40-45 min | 3+ | Media tests fail |
| #5: Timeout Inconsistency | Medium | 10 | 2-2.5 hrs | 13+ | Unreliable tests |
| **TOTAL** | - | **36** | **~7-8 hrs** | **25+** | Full test suite |

---

## Quick Start Guide

**Just want tests to run?**
```bash
# Fix Error #1 (10 minutes)
cd qcut
# Edit apps/web/src/test/e2e/helpers/electron-helpers.ts:30
# Change: async (_, use) => {
# To:     async ({}, use) => {

# Verify fix
bun x playwright test simple-navigation.e2e.ts --project=electron
```

**Want reliable tests?**
1. Complete Phase 1 (10 min) - Fix Error #1
2. Complete Phase 2 (~5 hrs) - Fix Errors #4 and #2
3. Run test suite: `bun x playwright test --project=electron`

**Want production-ready tests?**
- Follow all phases in order (7-8 hours total)
- Track progress using subtask checklists
- Test incrementally after each error fix

---

## Progress Tracking Template

Copy this to track your progress:

```markdown
## Error Fix Progress

### Error #1: Destructuring Pattern
- [ ] Subtask 1.1: Update electronApp fixture
- [ ] Subtask 1.2: Verify no other underscore fixtures
- [ ] Subtask 1.3: Run simple navigation test
- [ ] Subtask 1.4: Run full test suite

### Error #2: waitForTimeout Anti-pattern
- [ ] Subtask 2.1: Create reference guide
- [ ] Subtask 2.2: Fix helpers/electron-helpers.ts
- [ ] Subtask 2.3: Fix simple-navigation.e2e.ts
- [ ] Subtask 2.4: Fix multi-media-management tests
- [ ] Subtask 2.5: Fix text-overlay-testing.e2e.ts
- [ ] Subtask 2.6: Fix file-operations tests
- [ ] Subtask 2.7: Fix auto-save-export tests
- [ ] Subtask 2.8: Fix ai-transcription tests
- [ ] Subtask 2.9: Verify all changes
- [ ] Subtask 2.10: Update e2e-testing-guide.md

### Error #3: test.skip() Usage
- [ ] Subtask 3.1: Update editor-navigation.e2e.ts
- [ ] Subtask 3.2: Verify the fix works
- [ ] Subtask 3.3: Check for similar patterns

### Error #4: Missing Test Fixtures
- [ ] Subtask 4.1: Verify fixtures directory exists
- [ ] Subtask 4.2: Check for existing fixture files
- [ ] Subtask 4.3: Create sample-video.mp4
- [ ] Subtask 4.4: Create sample-audio.mp3
- [ ] Subtask 4.5: Create sample-image.png
- [ ] Subtask 4.6: Add fixtures to git
- [ ] Subtask 4.7: Update e2e-testing-guide.md
- [ ] Subtask 4.8: Verify fixtures work in tests
- [ ] Subtask 4.9: Document fixture requirements

### Error #5: Timeout Inconsistency
- [ ] Subtask 5.1: Verify current timeout configuration
- [ ] Subtask 5.2: Create timeout standards document
- [ ] Subtask 5.3: Fix race condition in editor-navigation
- [ ] Subtask 5.4: Fix another race condition
- [ ] Subtask 5.5: Add explicit timeouts to simple-navigation
- [ ] Subtask 5.6: Standardize timeouts across all files
- [ ] Subtask 5.7: Create ESLint rule (optional)
- [ ] Subtask 5.8: Run full test suite
- [ ] Subtask 5.9: Update e2e-testing-guide.md
- [ ] Subtask 5.10: Document completion
```

---

**Document Owner**: E2E Test Infrastructure Team
**Last Updated**: 2025-10-23 (Added detailed subtasks for all errors)
**Next Review**: After Error #1 is fixed and tests can run

**For Questions**: See `docs/technical/e2e-testing-guide.md` or create an issue
