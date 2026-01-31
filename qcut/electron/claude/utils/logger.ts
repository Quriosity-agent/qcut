/**
 * Claude API Logger Utility
 * Provides consistent logging across all Claude handlers
 */

// Try to load electron-log, fallback to console if not available
let log: any;
try {
  log = require('electron-log');
} catch {
  log = console;
}

const PREFIX = '[Claude API]';

export const claudeLog = {
  info: (handler: string, message: string, ...args: any[]): void => {
    log.info(`${PREFIX}[${handler}] ${message}`, ...args);
  },
  
  warn: (handler: string, message: string, ...args: any[]): void => {
    log.warn(`${PREFIX}[${handler}] ${message}`, ...args);
  },
  
  error: (handler: string, message: string, ...args: any[]): void => {
    log.error(`${PREFIX}[${handler}] ${message}`, ...args);
  },
  
  debug: (handler: string, message: string, ...args: any[]): void => {
    if (log.debug) {
      log.debug(`${PREFIX}[${handler}] ${message}`, ...args);
    } else {
      log.log(`${PREFIX}[${handler}] ${message}`, ...args);
    }
  },
};

// CommonJS export for compatibility
module.exports = { claudeLog };
