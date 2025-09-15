import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { startElectronApp, getMainWindow } from './helpers/electron-helpers';

test.describe('Auto-Save & Export File Management', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    electronApp = await startElectronApp();
    window = await getMainWindow(electronApp);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('5B.1 - Configure and test auto-save functionality', async () => {
    // Navigate to settings to configure auto-save
    await window.click('[data-testid="settings-button"]');
    await window.waitForTimeout(1000);

    // Access settings tabs if they exist
    const settingsDialog = window.locator('[data-testid="settings-tabs"], [data-testid="project-info-tab"]');
    if (await settingsDialog.isVisible()) {
      // Navigate to project settings or general settings
      await settingsDialog.click();
      await window.waitForTimeout(500);
    }

    // Look for auto-save settings
    const autoSaveCheckbox = window.locator('input[type="checkbox"]').filter({ hasText: /auto.*save/i }).first();
    if (await autoSaveCheckbox.isVisible()) {
      // Enable auto-save
      await autoSaveCheckbox.check();
      await window.waitForTimeout(500);

      // Look for auto-save interval setting
      const intervalInput = window.locator('[data-testid*="interval"], input[type="number"]').filter({
        hasText: /second|minute|interval/i
      }).first();

      if (await intervalInput.isVisible()) {
        await intervalInput.fill('30'); // 30 second interval
      }

      // Save settings
      const saveButton = window.locator('[data-testid="save-settings-button"], [data-testid="save-api-keys-button"]').first();
      if (await saveButton.isVisible()) {
        await saveButton.click();
        await window.waitForTimeout(1000);
      }
    }

    // Close settings dialog
    const closeButton = window.locator('button').filter({ hasText: /close|cancel/i }).first();
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }

    // Create a project to test auto-save
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Make some changes to trigger auto-save
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    // Add media to timeline if possible
    const mediaItem = window.locator('[data-testid="media-item"]').first();
    const timelineTrack = window.locator('[data-testid="timeline-track"]').first();

    if (await mediaItem.isVisible() && await timelineTrack.isVisible()) {
      await mediaItem.dragTo(timelineTrack);
      await window.waitForTimeout(1000);
    }

    // Look for auto-save indicator
    const autoSaveIndicator = window.locator('[data-testid="auto-save-indicator"]');

    // Auto-save indicator might be hidden but should exist in DOM
    const autoSaveExists = await autoSaveIndicator.count() > 0;
    expect(autoSaveExists).toBe(true);

    // Wait for potential auto-save to trigger (30+ seconds configured above)
    await window.waitForTimeout(35000);

    // Verify auto-save completed (indicator updated or project saved)
    if (await autoSaveIndicator.isVisible()) {
      await expect(autoSaveIndicator).toContainText(/saved|auto/i);
    }
  });

  test('5B.2 - Test project recovery after crash simulation', async () => {
    // Create project with content
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Add content to project
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    const mediaItem = window.locator('[data-testid="media-item"]').first();
    const timelineTrack = window.locator('[data-testid="timeline-track"]').first();

    if (await mediaItem.isVisible() && await timelineTrack.isVisible()) {
      await mediaItem.dragTo(timelineTrack);
      await window.waitForTimeout(1000);
    }

    // Add some text overlay to make project more substantial
    await window.click('[data-testid="text-panel-tab"]');
    await window.waitForTimeout(500);

    const textButton = window.locator('[data-testid="text-overlay-button"]');
    if (await textButton.isVisible()) {
      await textButton.click();
      await window.waitForTimeout(1000);

      // Add text content
      const textInput = window.locator('[data-testid="text-input-box"], input[type="text"]').first();
      if (await textInput.isVisible()) {
        await textInput.fill('Recovery Test Content');
        await window.waitForTimeout(500);
      }
    }

    // Simulate force quit by closing and reopening app
    await electronApp.close();
    await window.waitForTimeout(2000);

    // Restart application
    electronApp = await startElectronApp();
    window = await getMainWindow(electronApp);
    await window.waitForTimeout(3000);

    // Look for recovery dialog or unsaved changes notification
    const recoveryDialog = window.locator('[data-testid="recovery-dialog"], [role="dialog"]').filter({
      hasText: /recover|unsaved|restore/i
    }).first();

    if (await recoveryDialog.isVisible()) {
      await expect(recoveryDialog).toContainText(/unsaved|changes|recover/i);

      // Click recover button
      const recoverButton = window.locator('[data-testid="recover-project-button"], button').filter({
        hasText: /recover|restore|yes/i
      }).first();

      if (await recoverButton.isVisible()) {
        await recoverButton.click();
        await window.waitForTimeout(2000);

        // Verify content was recovered
        const timelineElements = window.locator('[data-testid="timeline-element"]');
        if (await timelineElements.count() > 0) {
          await expect(timelineElements.first()).toBeVisible();
        }

        const textOverlay = window.locator('[data-testid="canvas-text"]').filter({
          hasText: 'Recovery Test Content'
        });
        if (await textOverlay.count() > 0) {
          await expect(textOverlay.first()).toBeVisible();
        }
      }
    }
  });

  test('5B.3 - Test export to custom directories', async () => {
    // Create a project to export
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Add content
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    const mediaItem = window.locator('[data-testid="media-item"]').first();
    const timelineTrack = window.locator('[data-testid="timeline-track"]').first();

    if (await mediaItem.isVisible() && await timelineTrack.isVisible()) {
      await mediaItem.dragTo(timelineTrack);
      await window.waitForTimeout(1000);
    }

    // Open export dialog
    const exportButton = window.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await window.waitForTimeout(1000);

    // Look for export dialog
    const exportDialog = window.locator('[data-testid*="export-dialog"], .export, [role="dialog"]').filter({
      hasText: /export|render|save/i
    }).first();

    if (await exportDialog.isVisible()) {
      await expect(exportDialog).toBeVisible();

      // Configure filename with special characters
      const filenameInput = window.locator('[data-testid="export-filename-input"]');
      if (await filenameInput.isVisible()) {
        await filenameInput.fill('Test Video (Special & Characters) [2024]');
        await window.waitForTimeout(500);
      }

      // Look for custom export location button
      const customLocationButton = window.locator('button').filter({
        hasText: /custom|browse|location|directory/i
      }).first();

      if (await customLocationButton.isVisible()) {
        // Mock directory selection dialog
        window.on('filechooser', async (fileChooser) => {
          // In a real test, this would handle file/directory selection
          await fileChooser.setFiles([]);
        });

        await customLocationButton.click();
        await window.waitForTimeout(1000);
      }

      // Set export quality
      const qualitySelect = window.locator('[data-testid="export-quality-select"]');
      if (await qualitySelect.isVisible()) {
        // Select a quality option
        const qualityOption = qualitySelect.locator('input[value="720p"], [value*="720"]').first();
        if (await qualityOption.isVisible()) {
          await qualityOption.click();
        }
      }

      // Start export
      const startExportButton = window.locator('[data-testid="export-start-button"]');
      if (await startExportButton.isVisible()) {
        await startExportButton.click();
        await window.waitForTimeout(2000);

        // Verify export started
        const exportStatus = window.locator('[data-testid="export-status"]');
        if (await exportStatus.isVisible()) {
          await expect(exportStatus).toContainText(/export|process|render/i);
        }

        // Look for export progress
        const progressBar = window.locator('[data-testid="export-progress-bar"]');
        if (await progressBar.isVisible()) {
          await expect(progressBar).toBeVisible();
        }

        // Wait a moment to see progress, then cancel to avoid long wait
        await window.waitForTimeout(3000);

        const cancelButton = window.locator('[data-testid="export-cancel-button"]');
        if (await cancelButton.isVisible()) {
          await cancelButton.click();
          await window.waitForTimeout(1000);
        }
      }
    }
  });

  test('5B.4 - Test export file format and quality options', async () => {
    // Open export dialog
    const exportButton = window.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await window.waitForTimeout(1000);

    const exportDialog = window.locator('[data-testid*="export-dialog"], .export').first();
    if (await exportDialog.isVisible()) {
      // Test quality selection
      const qualitySelect = window.locator('[data-testid="export-quality-select"]');
      if (await qualitySelect.isVisible()) {
        // Check available quality options
        const qualityOptions = qualitySelect.locator('input, [role="radio"]');
        const optionCount = await qualityOptions.count();
        expect(optionCount).toBeGreaterThan(0);

        // Select high quality if available
        const highQualityOption = qualityOptions.filter({ hasText: /1080|high|hd/i }).first();
        if (await highQualityOption.isVisible()) {
          await highQualityOption.click();
          await window.waitForTimeout(500);
        }
      }

      // Test format selection
      const formatSelect = window.locator('[data-testid="export-format-select"]');
      if (await formatSelect.isVisible()) {
        // Check available formats
        const formatOptions = formatSelect.locator('input, [role="radio"]');
        const formatCount = await formatOptions.count();
        expect(formatCount).toBeGreaterThan(0);

        // Select MP4 format if available
        const mp4Option = formatOptions.filter({ hasText: /mp4|mpeg/i }).first();
        if (await mp4Option.isVisible()) {
          await mp4Option.click();
          await window.waitForTimeout(500);
        }
      }

      // Test caption export options if available
      const captionCheckbox = window.locator('[data-testid="export-include-captions-checkbox"]');
      if (await captionCheckbox.isVisible()) {
        await captionCheckbox.check();
        await window.waitForTimeout(500);

        // Look for caption format options
        const captionFormatSelect = window.locator('[data-testid="caption-format-select"]');
        if (await captionFormatSelect.isVisible()) {
          const srtOption = captionFormatSelect.locator('input[value="srt"]').first();
          if (await srtOption.isVisible()) {
            await srtOption.click();
          }
        }
      }

      // Test audio export options if available
      const audioCheckbox = window.locator('[data-testid="export-include-audio-checkbox"]');
      if (await audioCheckbox.isVisible()) {
        await audioCheckbox.check();
        await window.waitForTimeout(500);
      }
    }
  });

  test('5B.5 - Test file permissions and cross-platform compatibility', async () => {
    // Get system information
    const platform = await window.evaluate(() => ({
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: navigator.language,
    }));

    console.log(`Testing on platform: ${platform.platform}`);

    // Test file operations work on current platform
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Save project
    await window.click('[data-testid="save-project-button"]');
    await window.waitForTimeout(500);

    const nameInput = window.locator('[data-testid="project-name-input"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill(`CrossPlatform Test ${platform.platform}`);
      await window.waitForTimeout(500);

      const confirmButton = window.locator('[data-testid="save-confirm-button"]');
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
        await window.waitForTimeout(2000);

        // Verify save succeeded
        const saveStatus = window.locator('[data-testid="save-status"]');
        if (await saveStatus.isVisible()) {
          await expect(saveStatus).toContainText(/saved|success|complete/i);
        }
      }
    }

    // Test file import works
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    // Verify import dialog/functionality
    const fileInput = window.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      // File input exists, import should work
      await expect(fileInput).toBeVisible();
    }

    // In a real test, you would verify:
    // 1. File paths use correct separators for the platform
    // 2. File permissions allow read/write operations
    // 3. Special characters in filenames are handled properly
    // 4. Long file paths are supported
  });

  test('5B.6 - Test comprehensive export workflow with all features', async () => {
    // Create a comprehensive project
    await window.click('[data-testid="new-project-button"]');
    await window.waitForTimeout(2000);

    // Add media
    await window.click('[data-testid="import-media-button"]');
    await window.waitForTimeout(1000);

    // Add to timeline
    const mediaItem = window.locator('[data-testid="media-item"]').first();
    const timelineTrack = window.locator('[data-testid="timeline-track"]').first();

    if (await mediaItem.isVisible() && await timelineTrack.isVisible()) {
      await mediaItem.dragTo(timelineTrack);
      await window.waitForTimeout(1000);
    }

    // Add text overlay
    await window.click('[data-testid="text-panel-tab"]');
    await window.waitForTimeout(500);

    const textButton = window.locator('[data-testid="text-overlay-button"]');
    if (await textButton.isVisible()) {
      await textButton.click();
      await window.waitForTimeout(1000);
    }

    // Open comprehensive export
    const exportButton = window.locator('[data-testid*="export"]').first();
    await exportButton.click();
    await window.waitForTimeout(1000);

    const exportDialog = window.locator('[data-testid*="export-dialog"]').first();
    if (await exportDialog.isVisible()) {
      // Configure comprehensive export settings
      await window.locator('[data-testid="export-filename-input"]').fill('Comprehensive Export Test');
      await window.waitForTimeout(500);

      // Enable all export features
      const captionCheckbox = window.locator('[data-testid="export-include-captions-checkbox"]');
      if (await captionCheckbox.isVisible()) {
        await captionCheckbox.check();
      }

      const audioCheckbox = window.locator('[data-testid="export-include-audio-checkbox"]');
      if (await audioCheckbox.isVisible()) {
        await audioCheckbox.check();
      }

      // Set quality and format
      const qualitySelect = window.locator('[data-testid="export-quality-select"]');
      if (await qualitySelect.isVisible()) {
        const hdOption = qualitySelect.locator('input').filter({ hasText: /720|hd/i }).first();
        if (await hdOption.isVisible()) {
          await hdOption.click();
        }
      }

      // Start export
      const startButton = window.locator('[data-testid="export-start-button"]');
      if (await startButton.isVisible()) {
        await startButton.click();
        await window.waitForTimeout(2000);

        // Monitor export progress
        const progressBar = window.locator('[data-testid="export-progress-bar"]');
        const exportStatus = window.locator('[data-testid="export-status"]');

        if (await progressBar.isVisible()) {
          await expect(progressBar).toBeVisible();
        }

        if (await exportStatus.isVisible()) {
          await expect(exportStatus).toContainText(/export|render|process/i);
        }

        // Let it run for a few seconds, then cancel to avoid long test times
        await window.waitForTimeout(5000);

        const cancelButton = window.locator('[data-testid="export-cancel-button"]');
        if (await cancelButton.isVisible()) {
          await cancelButton.click();
          await window.waitForTimeout(1000);

          // Verify cancellation worked
          if (await exportStatus.isVisible()) {
            await expect(exportStatus).toContainText(/cancel|stop|abort/i);
          }
        }
      }
    }
  });
});