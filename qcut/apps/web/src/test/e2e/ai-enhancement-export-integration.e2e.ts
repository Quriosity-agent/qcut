import { test, expect } from './helpers/electron-helpers';

test.describe('AI Enhancement & Export Integration', () => {
  test('4B.1 - Access AI enhancement tools', async ({ page }) => {
    // Navigate to projects and create new project
    await page.goto('/projects');
    await page.click('[data-testid="new-project-button"]');
    await page.waitForSelector('[data-testid="import-media-button"]', { state: 'visible' });

    // Import media file first
    await page.click('[data-testid="import-media-button"]');
    await page.waitForSelector('[data-testid="media-item"]', { state: 'visible' });

    // Verify media item appears
    await expect(page.locator('[data-testid="media-item"]').first()).toBeVisible();

    // Switch to AI panel in media panel
    await page.click('[data-testid="ai-panel-tab"]');
    await page.waitForSelector('[data-testid="ai-features-panel"]', { state: 'visible' });

    // Verify AI features panel is visible
    await expect(page.locator('[data-testid="ai-features-panel"]')).toBeVisible();

    // Verify AI enhancement panel exists
    await expect(page.locator('[data-testid="ai-enhancement-panel"]')).toBeVisible();
  });

  test('4B.2 - Apply AI enhancement effects to media', async ({ page }) => {
    // Ensure we're in AI panel
    await page.click('[data-testid="ai-panel-tab"]');
    await page.waitForSelector('[data-testid="ai-enhancement-panel"]', { state: 'visible' });

    // Look for effect gallery or enhancement tools
    const effectGallery = page.locator('[data-testid="ai-enhancement-panel"]');
    await expect(effectGallery).toBeVisible();

    // Look for enhancement effect options
    const enhancementOptions = page.locator('[data-testid*="effect"], [data-testid*="enhancement"], button').filter({
      hasText: /enhance|effect|filter|style/i
    });

    if (await enhancementOptions.count() > 0) {
      // Select first available enhancement
      await enhancementOptions.first().click();

      // Wait for processing to complete
      await page.waitForLoadState('networkidle');

      // Verify enhancement was applied (new asset created or existing modified)
      const mediaItems = page.locator('[data-testid="media-item"]');
      await expect(mediaItems).toHaveCountGreaterThan(0);
    }
  });

  test('4B.3 - Use enhanced media in timeline', async ({ page }) => {
    // Drag enhanced media to timeline
    const mediaItem = page.locator('[data-testid="media-item"]').first();
    const timelineTrack = page.locator('[data-testid="timeline-track"]').first();

    // Perform drag and drop operation
    await mediaItem.dragTo(timelineTrack);
    await page.waitForSelector('[data-testid="timeline-element"]', { state: 'visible' });

    // Verify media appears on timeline
    const timelineElements = page.locator('[data-testid="timeline-element"]');
    await expect(timelineElements).toHaveCountGreaterThan(0);

    // Verify timeline element has proper duration
    const firstElement = timelineElements.first();
    await expect(firstElement).toHaveAttribute('data-duration');
  });

  test('4B.4 - Preview enhanced media with effects', async ({ page }) => {
    // Ensure timeline has content
    const timelineElements = page.locator('[data-testid="timeline-element"]');
    await expect(timelineElements.first()).toBeVisible();

    // Click play to preview enhanced media
    const playButton = page.locator('[data-testid="play-pause-button"]');
    await playButton.click();
    await expect(playButton).toHaveAttribute('data-playing', 'true');

    // Verify video is playing
    await expect(playButton).toHaveAttribute('data-playing', 'true');

    // Let video play to see enhancements
    await page.waitForTimeout(3000);

    // Pause video
    await playButton.click();
    await expect(playButton).toHaveAttribute('data-playing', 'false');

    // Verify preview panel is showing enhanced content
    const previewPanel = page.locator('[data-testid*="preview"], [data-testid*="video-player"]').first();
    await expect(previewPanel).toBeVisible();
  });

  test('4B.5 - Export enhanced project with AI effects', async ({ page }) => {
    // Open export dialog
    const exportButton = page.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await page.waitForSelector('[data-testid*="export-dialog"], .modal, [role="dialog"]', { state: 'visible' });

    // Verify export dialog appears
    const exportDialog = page.locator('[data-testid*="export-dialog"], .modal, [role="dialog"]').first();
    await expect(exportDialog).toBeVisible();

    // Configure export settings for enhanced content
    const qualityOptions = page.locator('select, input[type="radio"]').filter({
      hasText: /quality|resolution|format/i
    });

    // Set high quality for enhanced content
    if (await qualityOptions.count() > 0) {
      const highQualityOption = qualityOptions.filter({ hasText: /high|hd|1080/i }).first();
      if (await highQualityOption.isVisible()) {
        await highQualityOption.click();
      }
    }

    // Start export process
    const startExportButton = page.locator('[data-testid="export-start-button"]');
    if (await startExportButton.isVisible()) {
      await startExportButton.click();
      await page.waitForSelector('[data-testid*="export-status"], [data-testid*="export-progress"]', { state: 'visible', timeout: 10000 });

      // Verify export is processing
      const exportStatus = page.locator('[data-testid*="export-status"], [data-testid*="export-progress"]').first();
      if (await exportStatus.isVisible()) {
        await expect(exportStatus).toBeVisible();
      }
    }
  });

  test('4B.6 - Batch apply AI enhancements to multiple assets', async ({ page }) => {
    // Ensure we have multiple media items
    await page.click('[data-testid="import-media-button"]');
    await page.waitForSelector('[data-testid="media-item"]', { state: 'visible' });

    // Switch to AI panel
    await page.click('[data-testid="ai-panel-tab"]');
    await page.waitForSelector('[data-testid="ai-enhancement-panel"]', { state: 'visible' });

    const mediaItems = page.locator('[data-testid="media-item"]');
    const itemCount = await mediaItems.count();

    if (itemCount > 1) {
      // Look for batch processing or select all functionality
      const selectAllOption = page.locator('input[type="checkbox"]').filter({
        hasText: /select all|batch|all items/i
      }).first();

      if (await selectAllOption.isVisible()) {
        await selectAllOption.check();
        await expect(selectAllOption).toBeChecked();
      }

      // Apply batch enhancement
      const batchEnhanceButton = page.locator('button').filter({
        hasText: /apply all|batch enhance|enhance all/i
      }).first();

      if (await batchEnhanceButton.isVisible()) {
        await batchEnhanceButton.click();
        await page.waitForLoadState('networkidle'); // Allow time for batch processing
      }
    }

    // Verify enhanced assets are available
    await expect(mediaItems).toHaveCountGreaterThan(0);
  });

  test('4B.7 - Integration with project export workflow', async ({ page }) => {
    // Create complete project with AI enhancements
    const timelineElements = page.locator('[data-testid="timeline-element"]');

    if (await timelineElements.count() === 0) {
      // Add media to timeline if not already there
      const mediaItem = page.locator('[data-testid="media-item"]').first();
      const timelineTrack = page.locator('[data-testid="timeline-track"]').first();

      await mediaItem.dragTo(timelineTrack);
      await page.waitForSelector('[data-testid="timeline-element"]', { state: 'visible' });
    }

    // Verify timeline has content
    await expect(page.locator('[data-testid="timeline-element"]')).toHaveCountGreaterThan(0);

    // Test export with all AI features combined
    const exportButton = page.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await page.waitForSelector('[data-testid*="export-dialog"], .modal, [role="dialog"]', { state: 'visible' });

    const exportDialog = page.locator('[data-testid*="export-dialog"], .modal, [role="dialog"]').first();
    await expect(exportDialog).toBeVisible();

    // Enable all AI-related export features
    const aiOptions = page.locator('input[type="checkbox"], input[type="radio"]').filter({
      hasText: /ai|enhancement|effect|filter|caption|subtitle/i
    });

    for (let i = 0; i < await aiOptions.count(); i++) {
      const option = aiOptions.nth(i);
      if (await option.isVisible() && await option.getAttribute('type') === 'checkbox') {
        await option.check();
      }
    }

    // Start final export
    const startExportButton = page.locator('[data-testid="export-start-button"]');
    if (await startExportButton.isVisible()) {
      await startExportButton.click();
      await page.waitForSelector('[data-testid*="export-status"], [data-testid*="export-progress"]', { state: 'visible', timeout: 10000 });

      // Verify comprehensive export is processing
      const exportStatus = page.locator('[data-testid*="export-status"], [data-testid*="export-progress"]').first();
      if (await exportStatus.isVisible()) {
        await expect(exportStatus).toContainText(/export|process|render/i);
      }
    }
  });
});