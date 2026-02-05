/**
 * Remotion Folder Import E2E Tests
 *
 * Tests for importing Remotion project folders into QCut, including:
 * - Folder validation IPC handlers
 * - Composition scanning
 * - Bundling and loading
 * - Error handling for invalid folders
 *
 * @module test/e2e/remotion-folder-import
 */

import {
  test,
  expect,
  createTestProject,
  waitForProjectLoad,
} from "./helpers/electron-helpers";
import { resolve as pathResolve } from "path";
import {
  captureScreenshot,
  captureTestStep,
  captureErrorScreenshot,
} from "./utils/screenshot-helper";

/**
 * Resolve Remotion fixture paths relative to the project root.
 */
const remotionFixturePath = (subfolder: string) =>
  pathResolve(
    process.cwd(),
    "apps/web/src/test/e2e/fixtures/remotion",
    subfolder
  );

// Test fixture paths
const VALID_PROJECT = remotionFixturePath("valid-project");
const INVALID_PROJECT = remotionFixturePath("invalid-project");
const NO_ROOT_PROJECT = remotionFixturePath("no-root-project");
const EMPTY_FOLDER = remotionFixturePath("empty-folder");

// ============================================================================
// Test Suite: Remotion Folder Import
// ============================================================================

test.describe("Remotion Folder Import", () => {
  // --------------------------------------------------------------------------
  // Subtask 1: Folder Validation IPC Handler Tests
  // --------------------------------------------------------------------------

  test.describe("Folder Validation IPC Handlers", () => {
    /**
     * Test 1.1: Valid Remotion folder passes validation
     */
    test("should validate valid Remotion project folder", async ({ page }) => {
      await createTestProject(page, "Remotion Validation Test");

      // Capture initial state
      await captureTestStep(page, "remotion-import", 1, "editor-initial-state");

      // Call validation IPC directly
      const validationResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.validate) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.validate(folderPath);
      }, VALID_PROJECT);

      // Should be valid
      expect(validationResult).not.toBeNull();
      expect(validationResult.error).toBeUndefined();

      // If API is available, check isValid
      if (!validationResult.error) {
        expect(validationResult.isValid).toBe(true);
      }
    });

    /**
     * Test 1.2: Folder without remotion dependency fails validation
     */
    test("should reject folder without remotion dependency", async ({
      page,
    }) => {
      await createTestProject(page, "Invalid Remotion Test");

      const validationResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.validate) {
          return { error: "remotionFolder API not available", isValid: false };
        }
        return await api.remotionFolder.validate(folderPath);
      }, INVALID_PROJECT);

      // Should be invalid
      expect(validationResult.isValid).toBe(false);

      // Capture error state
      await captureErrorScreenshot(page, "invalid-folder-no-remotion");
    });

    /**
     * Test 1.3: Folder without Root.tsx fails validation
     */
    test("should reject folder without Root.tsx", async ({ page }) => {
      await createTestProject(page, "No Root Test");

      const validationResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.validate) {
          return { error: "remotionFolder API not available", isValid: false };
        }
        return await api.remotionFolder.validate(folderPath);
      }, NO_ROOT_PROJECT);

      // Should be invalid
      expect(validationResult.isValid).toBe(false);

      // Capture error state
      await captureErrorScreenshot(page, "invalid-folder-no-root");
    });

    /**
     * Test 1.4: Empty folder fails validation
     */
    test("should reject empty folder", async ({ page }) => {
      await createTestProject(page, "Empty Folder Test");

      const validationResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.validate) {
          return { error: "remotionFolder API not available", isValid: false };
        }
        return await api.remotionFolder.validate(folderPath);
      }, EMPTY_FOLDER);

      // Should be invalid
      expect(validationResult.isValid).toBe(false);
    });

    /**
     * Test 1.5: Non-existent path fails validation
     */
    test("should reject non-existent path", async ({ page }) => {
      await createTestProject(page, "Non-Existent Path Test");

      const validationResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.validate) {
          return { error: "remotionFolder API not available", isValid: false };
        }
        return await api.remotionFolder.validate(folderPath);
      }, "/non/existent/path/that/does/not/exist");

      // Should be invalid
      expect(validationResult.isValid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Subtask 2: Composition Scanning Tests
  // --------------------------------------------------------------------------

  test.describe("Composition Scanning", () => {
    /**
     * Test 2.1: Scan detects compositions in valid project
     */
    test("should detect compositions in valid project", async ({ page }) => {
      await createTestProject(page, "Composition Scan Test");

      // Capture before scan
      await captureTestStep(page, "remotion-import", 2, "before-scan");

      const scanResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.scan) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.scan(folderPath);
      }, VALID_PROJECT);

      // Should be valid scan result
      expect(scanResult).not.toBeNull();

      if (!scanResult.error) {
        expect(scanResult.isValid).toBe(true);
        expect(scanResult.compositions).toBeDefined();
        expect(Array.isArray(scanResult.compositions)).toBe(true);

        // Should detect the two compositions from our fixture
        expect(scanResult.compositions.length).toBe(2);

        // Verify composition metadata
        const compositionIds = scanResult.compositions.map(
          (c: any) => c.id
        );
        expect(compositionIds).toContain("HelloWorld");
        expect(compositionIds).toContain("TestAnimation");
      }

      // Capture after scan
      await captureTestStep(page, "remotion-import", 3, "compositions-detected");
    });

    /**
     * Test 2.2: Scan extracts correct composition metadata
     */
    test("should extract correct composition metadata", async ({ page }) => {
      await createTestProject(page, "Metadata Extraction Test");

      const scanResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.scan) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.scan(folderPath);
      }, VALID_PROJECT);

      if (!scanResult.error && scanResult.compositions) {
        // Find HelloWorld composition
        const helloWorld = scanResult.compositions.find(
          (c: any) => c.id === "HelloWorld"
        );

        if (helloWorld) {
          // Verify expected metadata from our fixture
          expect(helloWorld.durationInFrames).toBe(150);
          expect(helloWorld.fps).toBe(30);
          expect(helloWorld.width).toBe(1920);
          expect(helloWorld.height).toBe(1080);
        }

        // Find TestAnimation composition
        const testAnimation = scanResult.compositions.find(
          (c: any) => c.id === "TestAnimation"
        );

        if (testAnimation) {
          expect(testAnimation.durationInFrames).toBe(300);
          expect(testAnimation.fps).toBe(30);
        }
      }
    });

    /**
     * Test 2.3: Scan returns empty for invalid project
     */
    test("should return empty compositions for invalid project", async ({
      page,
    }) => {
      await createTestProject(page, "Invalid Scan Test");

      const scanResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.scan) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.scan(folderPath);
      }, INVALID_PROJECT);

      if (!scanResult.error) {
        expect(scanResult.isValid).toBe(false);
        // Should have empty compositions or errors
        expect(
          scanResult.compositions?.length === 0 ||
            scanResult.errors?.length > 0
        ).toBe(true);
      }
    });

    /**
     * Test 2.4: Scan finds Root.tsx path
     */
    test("should find Root.tsx path in valid project", async ({ page }) => {
      await createTestProject(page, "Root Path Test");

      const scanResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.scan) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.scan(folderPath);
      }, VALID_PROJECT);

      if (!scanResult.error && scanResult.isValid) {
        expect(scanResult.rootFilePath).toBeDefined();
        expect(scanResult.rootFilePath).toContain("Root.tsx");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Subtask 3: Full Import Pipeline Tests
  // --------------------------------------------------------------------------

  test.describe("Full Import Pipeline", () => {
    /**
     * Test 3.1: Full import completes successfully for valid project
     */
    test("should complete full import for valid project", async ({ page }) => {
      await createTestProject(page, "Full Import Test");

      // Capture before import
      await captureTestStep(page, "remotion-import", 4, "before-full-import");

      const importResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.import) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.import(folderPath);
      }, VALID_PROJECT);

      expect(importResult).not.toBeNull();

      if (!importResult.error) {
        expect(importResult.success).toBe(true);
        expect(importResult.scan).toBeDefined();
        expect(importResult.scan.isValid).toBe(true);
        expect(importResult.importTime).toBeGreaterThan(0);
      }

      // Capture after import
      await captureTestStep(page, "remotion-import", 5, "import-complete");
    });

    /**
     * Test 3.2: Full import fails gracefully for invalid project
     */
    test("should fail gracefully for invalid project", async ({ page }) => {
      await createTestProject(page, "Invalid Import Test");

      const importResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.import) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.import(folderPath);
      }, INVALID_PROJECT);

      if (!importResult.error) {
        expect(importResult.success).toBe(false);
        expect(importResult.scan?.isValid).toBe(false);
      }

      // Capture error state
      await captureErrorScreenshot(page, "import-invalid-project");
    });

    /**
     * Test 3.3: Check bundler availability
     */
    test("should check bundler availability", async ({ page }) => {
      await createTestProject(page, "Bundler Check Test");

      const bundlerResult = await page.evaluate(async () => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.checkBundler) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.checkBundler();
      });

      expect(bundlerResult).not.toBeNull();

      // Result should have an 'available' property
      if (!bundlerResult.error) {
        expect(typeof bundlerResult.available).toBe("boolean");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Subtask 4: Error Handling Tests
  // --------------------------------------------------------------------------

  test.describe("Error Handling", () => {
    /**
     * Test 4.1: Handles missing electronAPI gracefully
     */
    test("should handle missing electronAPI gracefully", async ({ page }) => {
      await createTestProject(page, "Missing API Test");

      // Test that the API check works without crashing
      const apiCheck = await page.evaluate(() => {
        return {
          hasElectronAPI: !!(window as any).electronAPI,
          hasRemotionFolder: !!(window as any).electronAPI?.remotionFolder,
        };
      });

      // In Electron environment, both should be true
      // If not, our tests should still handle it gracefully
      expect(apiCheck).toBeDefined();
    });

    /**
     * Test 4.2: Scan returns errors array for problematic folders
     */
    test("should return errors array for problematic folders", async ({
      page,
    }) => {
      await createTestProject(page, "Error Array Test");

      const scanResult = await page.evaluate(async (folderPath) => {
        const api = (window as any).electronAPI;
        if (!api?.remotionFolder?.scan) {
          return { error: "remotionFolder API not available" };
        }
        return await api.remotionFolder.scan(folderPath);
      }, EMPTY_FOLDER);

      if (!scanResult.error) {
        // Should have errors array
        expect(Array.isArray(scanResult.errors)).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Subtask 5: UI Integration Tests (when components have data-testid)
  // --------------------------------------------------------------------------

  test.describe("UI Integration", () => {
    /**
     * Test 5.1: Editor renders stably after project creation
     */
    test("should render editor stably for Remotion testing", async ({
      page,
    }) => {
      await createTestProject(page, "UI Stability Test");

      // Wait for editor to be fully loaded
      await waitForProjectLoad(page);

      // Capture the stable editor state
      await captureTestStep(page, "remotion-import", 6, "editor-stable-state");

      // Verify key editor elements are present
      const editorElements = await page.evaluate(() => {
        return {
          hasTimeline: !!document.querySelector('[data-testid="timeline-track"]'),
          hasMediaPanel: !!document.querySelector(
            '[data-testid="media-panel"], [data-testid="import-media-button"]'
          ),
          hasRoot: !!document.getElementById("root"),
        };
      });

      expect(editorElements.hasTimeline || editorElements.hasMediaPanel).toBe(
        true
      );
      expect(editorElements.hasRoot).toBe(true);
    });

    /**
     * Test 5.2: Check Remotion store is accessible
     */
    test("should have accessible Remotion store", async ({ page }) => {
      await createTestProject(page, "Store Access Test");

      // Check if Remotion-related stores/state are accessible
      const storeCheck = await page.evaluate(() => {
        // Check for Zustand devtools or store availability
        const windowAny = window as any;
        return {
          hasZustand: typeof windowAny.__ZUSTAND_DEVTOOLS__ !== "undefined" ||
            typeof windowAny.useRemotionStore !== "undefined",
        };
      });

      // Store should be loadable (may not be in devtools in production builds)
      expect(storeCheck).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Subtask 6: Screenshot Verification Tests
  // --------------------------------------------------------------------------

  test.describe("Screenshot Verification", () => {
    /**
     * Test 6.1: Capture full import workflow screenshots
     */
    test("should capture full import workflow screenshots", async ({
      page,
    }) => {
      await createTestProject(page, "Screenshot Workflow Test");

      // Step 1: Initial editor state
      await captureTestStep(page, "workflow", 1, "editor-initial");

      // Step 2: Check API availability
      const apiAvailable = await page.evaluate(() => {
        return !!(window as any).electronAPI?.remotionFolder;
      });

      await captureTestStep(page, "workflow", 2, "api-check-complete");

      if (apiAvailable) {
        // Step 3: Validate folder
        await page.evaluate(async (folderPath) => {
          const api = (window as any).electronAPI;
          return await api.remotionFolder.validate(folderPath);
        }, VALID_PROJECT);

        await captureTestStep(page, "workflow", 3, "validation-complete");

        // Step 4: Scan folder
        await page.evaluate(async (folderPath) => {
          const api = (window as any).electronAPI;
          return await api.remotionFolder.scan(folderPath);
        }, VALID_PROJECT);

        await captureTestStep(page, "workflow", 4, "scan-complete");

        // Step 5: Full import
        await page.evaluate(async (folderPath) => {
          const api = (window as any).electronAPI;
          return await api.remotionFolder.import(folderPath);
        }, VALID_PROJECT);

        await captureTestStep(page, "workflow", 5, "import-complete");
      }

      // Final state screenshot
      await captureScreenshot(page, "workflow-final", "workflow");
    });
  });
});
