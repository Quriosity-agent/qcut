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

### References
- Playwright Fixtures Documentation: https://playwright.dev/docs/test-fixtures
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

---

## Recommended Fix Priority

1. **IMMEDIATE (Blocks all tests)**:
   - Error #1: Fix destructuring pattern in `electron-helpers.ts:29`

2. **HIGH PRIORITY (After #1 is fixed)**:
   - Error #2: Replace `waitForTimeout` with deterministic waits (start with most critical tests)
   - Error #4: Verify and create missing test fixtures

3. **MEDIUM PRIORITY**:
   - Error #3: Fix incorrect `test.skip()` usage
   - Error #5: Standardize timeouts and fix race conditions

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

**Document Owner**: E2E Test Infrastructure Team
**Next Review**: After Error #1 is fixed and tests can run
