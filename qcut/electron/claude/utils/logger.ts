/**
 * Claude API Logger Utility
 * Provides consistent logging across all Claude handlers
 */

import electronLog from 'electron-log';

type LogLike = Pick<typeof electronLog, 'info' | 'warn' | 'error' | 'debug' | 'log'>;
const log: LogLike = electronLog;

const PREFIX = '[Claude API]';

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
