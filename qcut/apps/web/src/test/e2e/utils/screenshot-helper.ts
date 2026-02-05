/**
 * Screenshot Helper for E2E Tests
 *
 * Provides utility functions for capturing screenshots during E2E tests
 * to visually verify test states and debug failures.
 *
 * @module test/e2e/utils/screenshot-helper
 */

import type { Page } from "@playwright/test";
import { resolve as pathResolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";

/**
 * Base directory for E2E test screenshots.
 * Screenshots are stored relative to the test directory.
 */
const SCREENSHOTS_BASE_DIR = pathResolve(
  process.cwd(),
  "apps/web/src/test/e2e/screenshots"
);

/**
 * Ensures the screenshot directory exists, creating it if necessary.
 *
 * @param dir - The directory path to ensure exists
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Captures a full-page or viewport screenshot and saves it to the screenshots directory.
 *
 * @param page - The Playwright page instance
 * @param name - Screenshot filename (without extension)
 * @param subfolder - Optional subfolder within screenshots directory
 * @param options - Additional screenshot options
 * @returns The absolute path to the saved screenshot
 *
 * @example
 * ```typescript
 * // Capture viewport screenshot
 * await captureScreenshot(page, "01-initial-state");
 *
 * // Capture screenshot in a subfolder
 * await captureScreenshot(page, "error-state", "errors");
 *
 * // Capture full-page screenshot
 * await captureScreenshot(page, "full-view", undefined, { fullPage: true });
 * ```
 */
export async function captureScreenshot(
  page: Page,
  name: string,
  subfolder?: string,
  options?: { fullPage?: boolean }
): Promise<string> {
  const dir = subfolder
    ? pathResolve(SCREENSHOTS_BASE_DIR, subfolder)
    : SCREENSHOTS_BASE_DIR;

  ensureDir(dir);

  const filePath = pathResolve(dir, `${name}.png`);

  await page.screenshot({
    path: filePath,
    fullPage: options?.fullPage ?? false,
  });

  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

/**
 * Captures a screenshot of a specific element identified by selector.
 *
 * @param page - The Playwright page instance
 * @param selector - CSS selector or data-testid for the element
 * @param name - Screenshot filename (without extension)
 * @param subfolder - Optional subfolder within screenshots directory
 * @returns The absolute path to the saved screenshot, or null if element not found
 *
 * @example
 * ```typescript
 * // Capture a specific component
 * await captureElementScreenshot(page, '[data-testid="preview-panel"]', "preview");
 *
 * // Capture with subfolder
 * await captureElementScreenshot(page, ".timeline", "timeline", "components");
 * ```
 */
export async function captureElementScreenshot(
  page: Page,
  selector: string,
  name: string,
  subfolder?: string
): Promise<string | null> {
  const dir = subfolder
    ? pathResolve(SCREENSHOTS_BASE_DIR, subfolder)
    : SCREENSHOTS_BASE_DIR;

  ensureDir(dir);

  const filePath = pathResolve(dir, `${name}.png`);

  const element = page.locator(selector);
  const count = await element.count();

  if (count === 0) {
    console.warn(`Element not found for screenshot: ${selector}`);
    return null;
  }

  await element.first().screenshot({ path: filePath });

  console.log(`Element screenshot saved: ${filePath}`);
  return filePath;
}

/**
 * Captures a screenshot for a specific test step with automatic numbering.
 * Useful for documenting a sequence of test actions.
 *
 * @param page - The Playwright page instance
 * @param testName - The test name (used as subfolder)
 * @param stepNumber - The step number for ordering
 * @param description - Brief description of the step
 * @returns The absolute path to the saved screenshot
 *
 * @example
 * ```typescript
 * await captureTestStep(page, "folder-import", 1, "empty-media-panel");
 * await captureTestStep(page, "folder-import", 2, "folder-dialog-open");
 * await captureTestStep(page, "folder-import", 3, "compositions-detected");
 * ```
 */
export async function captureTestStep(
  page: Page,
  testName: string,
  stepNumber: number,
  description: string
): Promise<string> {
  const paddedNumber = String(stepNumber).padStart(2, "0");
  const fileName = `${paddedNumber}-${description}`;
  return captureScreenshot(page, fileName, testName);
}

/**
 * Captures an error state screenshot with additional context.
 *
 * @param page - The Playwright page instance
 * @param name - Error screenshot name
 * @param error - Optional error object for logging
 * @returns The absolute path to the saved screenshot
 */
export async function captureErrorScreenshot(
  page: Page,
  name: string,
  error?: Error
): Promise<string> {
  if (error) {
    console.error(`Capturing error screenshot for: ${error.message}`);
  }

  return captureScreenshot(page, name, "errors");
}

/**
 * Cleans up screenshots directory before a test run.
 * Removes all existing screenshots to ensure fresh results.
 *
 * @param subfolder - Optional subfolder to clean (cleans all if not specified)
 */
export function cleanupScreenshots(subfolder?: string): void {
  const { rmSync } = require("fs");
  const dir = subfolder
    ? pathResolve(SCREENSHOTS_BASE_DIR, subfolder)
    : SCREENSHOTS_BASE_DIR;

  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`Cleaned up screenshots: ${dir}`);
  }
}
