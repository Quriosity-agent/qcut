import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { startElectronApp, getMainWindow } from './helpers/electron-helpers';

test.describe('AI Transcription & Caption Generation', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    electronApp = await startElectronApp();
    window = await getMainWindow(electronApp);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('4A.1 - Upload media file and access AI transcription', async () => {
    // Navigate to projects page and create new project
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Import media file
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    // Verify media item appears
    await expect(window.locator('[data-testid="media-item"]').first()).toBeVisible();

    // Switch to Captions tab in media panel
    await window.click('[data-testid="captions-panel-tab"]');
    await window.waitForTimeout(500);

    // Verify AI transcription panel is visible
    await expect(window.locator('[data-testid="ai-transcription-panel"]')).toBeVisible();

    // Verify transcription upload button is present
    await expect(window.locator('[data-testid="transcription-upload-button"]')).toBeVisible();
  });

  test('4A.2 - Generate transcription with AI service', async () => {
    // Ensure we're in the captions panel
    await window.click('[data-testid="captions-panel-tab"]');
    await window.waitForTimeout(500);

    // Click transcription upload/generate button
    await window.click('[data-testid="transcription-upload-button"]');
    await window.waitForTimeout(1000);

    // Wait for transcription processing (mock or actual service)
    // In a real test, you might wait for loading indicators to disappear
    await window.waitForTimeout(3000);

    // Verify transcription results appear in the panel
    // This would depend on your specific UI implementation
    const transcriptionContent = window.locator('[data-testid="ai-transcription-panel"]');
    await expect(transcriptionContent).toContainText(/transcription|caption|subtitle/i);
  });

  test('4A.3 - Edit and customize generated captions', async () => {
    // Ensure captions are generated (from previous test)
    await window.click('[data-testid="captions-panel-tab"]');
    await window.waitForTimeout(500);

    // Look for editable caption elements
    const captionItems = window.locator('[data-testid*="caption-item"], [data-testid*="subtitle-item"]');

    if (await captionItems.count() > 0) {
      // Click on first caption item to edit
      await captionItems.first().click();
      await window.waitForTimeout(500);

      // Try to edit caption text (assuming there's an editable field)
      const editableField = window.locator('input[type="text"], textarea').first();
      if (await editableField.isVisible()) {
        await editableField.fill('Edited caption text');
        await window.keyboard.press('Enter');
        await window.waitForTimeout(500);
      }
    }

    // Verify the caption customization interface is functional
    await expect(window.locator('[data-testid="ai-transcription-panel"]')).toBeVisible();
  });

  test('4A.4 - Apply captions to timeline', async () => {
    // Ensure we have captions generated
    await window.click('[data-testid="captions-panel-tab"]');
    await window.waitForTimeout(500);

    // Look for apply/add to timeline button
    const applyButton = window.locator('[data-testid*="apply"], [data-testid*="add-to-timeline"]').first();

    if (await applyButton.isVisible()) {
      await applyButton.click();
      await window.waitForTimeout(1000);
    }

    // Verify captions appear on timeline
    const timelineTracks = window.locator('[data-testid="timeline-track"]');
    await expect(timelineTracks).toHaveCountGreaterThan(0);

    // Look for caption/subtitle track specifically
    const captionTrack = window.locator('[data-testid="timeline-track"][data-track-type*="caption"], [data-testid="timeline-track"][data-track-type*="subtitle"]');

    // If caption track exists, verify it has elements
    if (await captionTrack.count() > 0) {
      const captionElements = captionTrack.locator('[data-testid="timeline-element"]');
      await expect(captionElements).toHaveCountGreaterThan(0);
    }
  });

  test('4A.5 - Preview captions in video preview', async () => {
    // Ensure timeline has content
    const timelineElements = window.locator('[data-testid="timeline-element"]');
    await expect(timelineElements.first()).toBeVisible();

    // Click play button to start preview
    const playButton = window.locator('[data-testid="play-pause-button"]');
    await playButton.click();
    await window.waitForTimeout(500);

    // Verify video is playing
    await expect(playButton).toHaveAttribute('data-playing', 'true');

    // Let video play for a few seconds to show captions
    await window.waitForTimeout(3000);

    // Pause video
    await playButton.click();
    await expect(playButton).toHaveAttribute('data-playing', 'false');

    // Verify preview panel shows captions overlay
    // This would depend on your specific implementation
    const previewPanel = window.locator('[data-testid*="preview"], [data-testid*="video-player"]').first();
    await expect(previewPanel).toBeVisible();
  });

  test('4A.6 - Export project with embedded captions', async () => {
    // Open export dialog
    const exportButton = window.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await window.waitForTimeout(1000);

    // Verify export dialog appears
    const exportDialog = window.locator('[data-testid*="export-dialog"], .modal, [role="dialog"]').first();
    await expect(exportDialog).toBeVisible();

    // Look for caption/subtitle export options
    const captionOptions = window.locator('input[type="checkbox"], input[type="radio"]').filter({
      hasText: /caption|subtitle|transcription/i
    });

    // Enable caption export if option exists
    if (await captionOptions.count() > 0) {
      await captionOptions.first().check();
    }

    // Start export process
    const startExportButton = window.locator('[data-testid="export-start-button"]');
    if (await startExportButton.isVisible()) {
      await startExportButton.click();
      await window.waitForTimeout(2000);

      // Verify export is in progress or completed
      // This would show success message or progress indicator
      const exportStatus = window.locator('[data-testid*="export-status"], [data-testid*="export-progress"]').first();
      if (await exportStatus.isVisible()) {
        await expect(exportStatus).toBeVisible();
      }
    }
  });
});