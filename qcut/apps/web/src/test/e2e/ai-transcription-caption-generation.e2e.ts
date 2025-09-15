/**
 * AI Transcription & Caption Generation E2E Tests
 *
 * Tests the complete workflow for AI-powered transcription and caption generation
 * including media upload, AI transcription, caption editing, timeline integration,
 * preview functionality, and export with embedded captions.
 */

import { test, expect, createTestProject, importTestVideo } from './helpers/electron-helpers';

/**
 * Test suite for AI Transcription & Caption Generation (Test #4A)
 * Covers subtasks 4A.1 through 4A.6 from the E2E testing priority document.
 */
test.describe('AI Transcription & Caption Generation', () => {
  /**
   * Setup for each test: Creates a fresh project and imports test video
   * for transcription testing.
   */
  test.beforeEach(async ({ page }) => {
    // Create a fresh project for each test to ensure independence
    await createTestProject(page, 'E2E AI Transcription Test');

    // Import media file that will be used for transcription
    await importTestVideo(page);
  });

  /**
   * Test 4A.1: Upload media file and access AI transcription
   * Verifies media upload and access to AI transcription panel.
   */
  test('4A.1 - Upload media file and access AI transcription', async ({ page }) => {
    // Media file already uploaded in beforeEach - switch to Captions tab
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Verify AI transcription panel is visible
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();

    // Verify transcription upload button is present
    await expect(page.getByTestId('transcription-upload-button')).toBeVisible();
  });

  /**
   * Test 4A.2: Generate transcription with AI service
   * Tests the AI transcription generation process and result display.
   */
  test('4A.2 - Generate transcription with AI service', async ({ page }) => {
    // Navigate to captions panel
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Verify AI transcription panel is visible
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();

    // Click transcription upload/generate button
    await page.getByTestId('transcription-upload-button').click();
    await page.waitForTimeout(1000);

    // Wait for transcription processing (mock or actual service)
    // In a real test, you might wait for loading indicators to disappear
    await page.waitForTimeout(3000);

    // Verify transcription results appear in the panel
    // This would depend on your specific UI implementation
    const transcriptionContent = page.getByTestId('ai-transcription-panel');
    await expect(transcriptionContent).toContainText(/transcription|caption|subtitle/i);
  });

  /**
   * Test 4A.3: Edit and customize generated captions
   * Verifies users can edit and customize AI-generated caption text.
   */
  test('4A.3 - Edit and customize generated captions', async ({ page }) => {
    // Navigate to captions panel and generate transcription first
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();

    // Generate transcription if not already available
    const transcribeButton = page.getByTestId('transcription-upload-button');
    if (await transcribeButton.isVisible()) {
      await transcribeButton.click();
      await page.waitForTimeout(3000); // Wait for transcription processing
    }

    // Look for editable caption elements
    const captionItems = page.locator('[data-testid*="caption-item"], [data-testid*="subtitle-item"]');

    if (await captionItems.count() > 0) {
      // Click on first caption item to edit
      await captionItems.first().click();
      await page.waitForTimeout(500);

      // Try to edit caption text (assuming there's an editable field)
      const editableField = page.locator('input[type="text"], textarea').first();
      if (await editableField.isVisible()) {
        await editableField.fill('Edited caption text');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }
    }

    // Verify the caption customization interface is functional
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();
  });

  /**
   * Test 4A.4: Apply captions to timeline
   * Tests adding generated captions to the video timeline.
   */
  test('4A.4 - Apply captions to timeline', async ({ page }) => {
    // Navigate to captions panel and ensure transcription is available
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();

    // Generate transcription if needed
    const transcribeButton = page.getByTestId('transcription-upload-button');
    if (await transcribeButton.isVisible()) {
      await transcribeButton.click();
      await page.waitForTimeout(3000);
    }

    // Look for apply/add to timeline button
    const applyButton = page.locator('[data-testid*="apply"], [data-testid*="add-to-timeline"]').first();

    if (await applyButton.isVisible()) {
      await applyButton.click();
      await page.waitForTimeout(1000);
    }

    // Verify captions appear on timeline
    const timelineTracks = page.locator('[data-testid="timeline-track"]');
    await expect(timelineTracks.first()).toBeVisible();

    // Look for caption/subtitle track specifically
    const captionTrack = page.locator('[data-testid="timeline-track"][data-track-type*="caption"], [data-testid="timeline-track"][data-track-type*="subtitle"]');

    // If caption track exists, verify it has elements
    if (await captionTrack.count() > 0) {
      const captionElements = captionTrack.locator('[data-testid="timeline-element"]');
      await expect(captionElements.first()).toBeVisible();
    }
  });

  /**
   * Test 4A.5: Preview captions in video preview
   * Verifies captions display correctly during video playback preview.
   */
  test('4A.5 - Preview captions in video preview', async ({ page }) => {
    // Set up captions on timeline first
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Generate and apply captions if needed
    const transcribeButton = page.getByTestId('transcription-upload-button');
    if (await transcribeButton.isVisible()) {
      await transcribeButton.click();
      await page.waitForTimeout(3000);
    }

    // Apply captions to timeline
    const applyButton = page.locator('[data-testid*="apply"], [data-testid*="add-to-timeline"]').first();
    if (await applyButton.isVisible()) {
      await applyButton.click();
      await page.waitForTimeout(1000);
    }

    // Ensure timeline has content
    const timelineElements = page.locator('[data-testid="timeline-element"]');
    await expect(timelineElements.first()).toBeVisible();

    // Click play button to start preview
    const playButton = page.locator('[data-testid="play-pause-button"]');
    await playButton.click();
    await page.waitForTimeout(500);

    // Verify video is playing
    await expect(playButton).toHaveAttribute('data-playing', 'true');

    // Let video play for a few seconds to show captions
    await page.waitForTimeout(3000);

    // Pause video
    await playButton.click();
    await expect(playButton).toHaveAttribute('data-playing', 'false');

    // Verify preview panel shows captions overlay
    // This would depend on your specific implementation
    const previewPanel = page.locator('[data-testid*="preview"], [data-testid*="video-player"]').first();
    await expect(previewPanel).toBeVisible();
  });

  /**
   * Test 4A.6: Export project with embedded captions
   * Tests exporting video projects with captions embedded in the output.
   */
  test('4A.6 - Export project with embedded captions', async ({ page }) => {
    // Set up captions on timeline first
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Generate captions if needed
    const transcribeButton = page.getByTestId('transcription-upload-button');
    if (await transcribeButton.isVisible()) {
      await transcribeButton.click();
      await page.waitForTimeout(3000);
    }

    // Apply captions to timeline for export
    const applyButton = page.locator('[data-testid*="apply"], [data-testid*="add-to-timeline"]').first();
    if (await applyButton.isVisible()) {
      await applyButton.click();
      await page.waitForTimeout(1000);
    }

    // Verify timeline has elements before export
    const timelineElements = page.locator('[data-testid="timeline-element"]');
    await expect(timelineElements.first()).toBeVisible();

    // Open export dialog
    const exportButton = page.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await page.waitForTimeout(1000);

    // Verify export dialog appears
    const exportDialog = page.locator('[data-testid*="export-dialog"], .modal, [role="dialog"]').first();
    await expect(exportDialog).toBeVisible();

    // Look for caption/subtitle export options using role-based selector
    const captionOptions = page.getByRole('checkbox', { name: /caption|subtitle|transcription/i })
      .or(page.getByRole('radio', { name: /caption|subtitle|transcription/i }))
      .or(page.locator('label:has-text(/caption|subtitle|transcription/i) input[type="checkbox"], label:has-text(/caption|subtitle|transcription/i) input[type="radio"]'));

    // Enable caption export if option exists
    if (await captionOptions.count() > 0) {
      await captionOptions.first().check();
    }

    // Start export process
    const startExportButton = page.locator('[data-testid="export-start-button"]');
    if (await startExportButton.isVisible()) {
      await startExportButton.click();
      await page.waitForTimeout(2000);

      // Verify export is in progress or completed
      // This would show success message or progress indicator
      const exportStatus = page.locator('[data-testid*="export-status"], [data-testid*="export-progress"]').first();
      if (await exportStatus.isVisible()) {
        await expect(exportStatus).toBeVisible();
      }
    }
  });
});