const { ipcMain, nativeTheme } = require('electron');

/**
 * Setup theme-related IPC handlers for Electron
 */
function setupThemeIPC() {
  // Get current theme
  ipcMain.handle('theme:get', () => {
    return nativeTheme.themeSource;
  });

  // Set theme (light, dark, or system)
  ipcMain.handle('theme:set', (event, theme) => {
    if (['light', 'dark', 'system'].includes(theme)) {
      nativeTheme.themeSource = theme;
      return theme;
    }
    throw new Error(`Invalid theme: ${theme}. Must be 'light', 'dark', or 'system'`);
  });

  // Toggle between light and dark
  ipcMain.handle('theme:toggle', () => {
    const newTheme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    nativeTheme.themeSource = newTheme;
    return newTheme;
  });

  // Get whether dark mode is active
  ipcMain.handle('theme:isDark', () => {
    return nativeTheme.shouldUseDarkColors;
  });

  // Listen for theme changes from the OS
  nativeTheme.on('updated', () => {
    // This event fires when the OS theme changes
    // You could emit this to the renderer if needed
  });
}

module.exports = { setupThemeIPC };