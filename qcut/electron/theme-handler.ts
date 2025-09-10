import { ipcMain, nativeTheme, IpcMainInvokeEvent } from "electron";

type ThemeSource = "system" | "light" | "dark";

interface ThemeHandlers {
  "theme:get": () => ThemeSource;
  "theme:set": (theme: ThemeSource) => ThemeSource;
  "theme:toggle": () => ThemeSource;
  "theme:isDark": () => boolean;
}

/**
 * Setup theme-related IPC handlers for Electron
 */
export function setupThemeIPC(): void {
  // Get current theme
  ipcMain.handle("theme:get", (): ThemeSource => {
    return nativeTheme.themeSource as ThemeSource;
  });

  // Set theme (light, dark, or system)
  ipcMain.handle(
    "theme:set",
    (event: IpcMainInvokeEvent, theme: ThemeSource): ThemeSource => {
      const validThemes: ThemeSource[] = ["light", "dark", "system"];
      if (validThemes.includes(theme)) {
        nativeTheme.themeSource = theme;
        return theme;
      }
      throw new Error(
        `Invalid theme: ${theme}. Must be 'light', 'dark', or 'system'`
      );
    }
  );

  // Toggle between light and dark
  ipcMain.handle("theme:toggle", (event: IpcMainInvokeEvent): ThemeSource => {
    const newTheme: ThemeSource = nativeTheme.shouldUseDarkColors
      ? "light"
      : "dark";
    nativeTheme.themeSource = newTheme;
    return newTheme;
  });

  // Get whether dark mode is active
  ipcMain.handle("theme:isDark", (): boolean => {
    return nativeTheme.shouldUseDarkColors;
  });

  // Listen for theme changes from the OS
  nativeTheme.on("updated", (): void => {
    // This event fires when the OS theme changes
    // You could emit this to the renderer if needed
  });
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupThemeIPC };

// ES6 export for TypeScript files
export default { setupThemeIPC };
export type { ThemeSource, ThemeHandlers };
