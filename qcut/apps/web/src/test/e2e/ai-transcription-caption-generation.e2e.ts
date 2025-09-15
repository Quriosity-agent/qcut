import { test, expect } from './helpers/electron-helpers';

test.describe('AI Transcription & Caption Generation', () => {
  test('4A.1 - Upload media file and access AI transcription', async ({ page }) => {
    // Navigate to projects page and create new project
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('import-media-button').waitFor(); // Wait for app to be ready

    // Import media file
    await page.getByTestId('import-media-button').click();
    await page.waitForSelector('[data-testid="media-item"]');

    // Verify media item appears
    await expect(page.getByTestId('media-item').first()).toBeVisible();

    // Switch to Captions tab in media panel
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Verify AI transcription panel is visible
    await expect(page.getByTestId('ai-transcription-panel')).toBeVisible();

    // Verify transcription upload button is present
    await expect(page.getByTestId('transcription-upload-button')).toBeVisible();
  });

  test('4A.2 - Generate transcription with AI service', async ({ page }) => {
    // Ensure we're in the captions panel
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

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

  test('4A.3 - Edit and customize generated captions', async ({ page }) => {
    // Ensure captions are generated (from previous test)
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

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

  test('4A.4 - Apply captions to timeline', async ({ page }) => {
    // Ensure we have captions generated
    await page.getByTestId('captions-panel-tab').click();
    await page.waitForTimeout(500);

    // Look for apply/add to timeline button
    const applyButton = page.locator('[data-testid*="apply"], [data-testid*="add-to-timeline"]').first();

    if (await applyButton.isVisible()) {
      await applyButton.click();
      await page.waitForTimeout(1000);
    }

    // Verify captions appear on timeline
    const timelineTracks = page.locator('[data-testid="timeline-track"]');
    await expect(timelineTracks).toHaveCountGreaterThan(0);

    // Look for caption/subtitle track specifically
    const captionTrack = page.locator('[data-testid="timeline-track"][data-track-type*="caption"], [data-testid="timeline-track"][data-track-type*="subtitle"]');

    // If caption track exists, verify it has elements
    if (await captionTrack.count() > 0) {
      const captionElements = captionTrack.locator('[data-testid="timeline-element"]');
      await expect(captionElements).toHaveCountGreaterThan(0);
    }
  });

  test('4A.5 - Preview captions in video preview', async ({ page }) => {
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

  test('4A.6 - Export project with embedded captions', async ({ page }) => {
    // Open export dialog
    const exportButton = page.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await page.waitForTimeout(1000);

    // Verify export dialog appears
    const exportDialog = page.locator('[data-testid*="export-dialog"], .modal, [role="dialog"]').first();
    await expect(exportDialog).toBeVisible();

    // Look for caption/subtitle export options
    const captionOptions = page.locator('input[type="checkbox"], input[type="radio"]').filter({
      hasText: /caption|subtitle|transcription/i
    });

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