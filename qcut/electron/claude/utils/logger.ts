/**
 * Claude API Logger Utility
 * Provides consistent logging across all Claude handlers
 */

type LogLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

// Use try-catch for electron-log to handle packaged app scenarios
let log: LogLike;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  log = require("electron-log");
} catch {
  // Fallback to console if electron-log is not available
  log = console;
}

const PREFIX = "[Claude API]";

export const claudeLog = {
  info: (handler: string, message: string, ...args: unknown[]): void => {
    log.info(`${PREFIX}[${handler}] ${message}`, ...args);
  },

  warn: (handler: string, message: string, ...args: unknown[]): void => {
    log.warn(`${PREFIX}[${handler}] ${message}`, ...args);
  },

  error: (handler: string, message: string, ...args: unknown[]): void => {
    log.error(`${PREFIX}[${handler}] ${message}`, ...args);
  },

  debug: (handler: string, message: string, ...args: unknown[]): void => {
    (log.debug ?? log.log)(`${PREFIX}[${handler}] ${message}`, ...args);
  },
};

// CommonJS export for compatibility
module.exports = { claudeLog };
