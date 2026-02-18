/**
 * XDG Base Directory Support
 *
 * Resolves config, cache, and state directories following
 * the XDG Base Directory Specification with platform fallbacks.
 *
 * Ported from: cli/paths.py
 *
 * @module electron/native-pipeline/xdg-paths
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const APP_NAME = 'qcut-pipeline';

/**
 * Resolve config directory.
 * Priority: XDG_CONFIG_HOME > %APPDATA% (win) > ~/.config (unix)
 */
export function configDir(override?: string): string {
  if (override) return ensureDir(override);

  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return ensureDir(path.join(xdg, APP_NAME));

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return ensureDir(path.join(appData, APP_NAME));
  }

  return ensureDir(path.join(os.homedir(), '.config', APP_NAME));
}

/**
 * Resolve cache directory.
 * Priority: XDG_CACHE_HOME > %LOCALAPPDATA%/cache (win) > ~/.cache (unix)
 */
export function cacheDir(override?: string): string {
  if (override) return ensureDir(override);

  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return ensureDir(path.join(xdg, APP_NAME));

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return ensureDir(path.join(localAppData, APP_NAME, 'cache'));
  }

  return ensureDir(path.join(os.homedir(), '.cache', APP_NAME));
}

/**
 * Resolve state directory.
 * Priority: XDG_STATE_HOME > %LOCALAPPDATA%/state (win) > ~/.local/state (unix)
 */
export function stateDir(override?: string): string {
  if (override) return ensureDir(override);

  const xdg = process.env.XDG_STATE_HOME;
  if (xdg) return ensureDir(path.join(xdg, APP_NAME));

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return ensureDir(path.join(localAppData, APP_NAME, 'state'));
  }

  return ensureDir(path.join(os.homedir(), '.local', 'state', APP_NAME));
}

/** Default config file path. */
export function defaultConfigPath(overrideDir?: string): string {
  return path.join(configDir(overrideDir), 'config.yaml');
}

/** Create directory if it doesn't exist and return the path. */
export function ensureDir(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}
