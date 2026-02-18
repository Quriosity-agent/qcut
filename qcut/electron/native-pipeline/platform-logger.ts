/**
 * Platform Logger
 *
 * Structured logger with ANSI color formatting, step tracking,
 * and cost reporting for pipeline execution.
 *
 * Ported from: utils/logger.py
 *
 * @module electron/native-pipeline/platform-logger
 */

import { ansi, colorize } from './cli-output.js';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

export class PlatformLogger {
  readonly name: string;
  private level: LogLevel;

  constructor(name: string, level: LogLevel = 'info') {
    this.name = name;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private prefix(): string {
    return colorize(`[${this.name}]`, 'dim');
  }

  info(message: string): void {
    if (!this.shouldLog('info')) return;
    console.log(`${this.prefix()} ${message}`);
  }

  warning(message: string): void {
    if (!this.shouldLog('warning')) return;
    console.error(`${this.prefix()} ${colorize(`warning: ${message}`, 'yellow')}`);
  }

  error(message: string): void {
    if (!this.shouldLog('error')) return;
    console.error(`${this.prefix()} ${colorize(`error: ${message}`, 'red')}`);
  }

  debug(message: string): void {
    if (!this.shouldLog('debug')) return;
    console.error(`${this.prefix()} ${colorize(message, 'dim')}`);
  }

  /** Log a pipeline step with blue arrow indicator. */
  step(message: string): void {
    if (!this.shouldLog('info')) return;
    console.log(`${this.prefix()} ${ansi.blue}${ansi.bold}→${ansi.reset} ${message}`);
  }

  /** Log a cost amount. */
  cost(amount: number, currency = 'USD'): void {
    if (!this.shouldLog('info')) return;
    console.log(`${this.prefix()} ${colorize(`Cost: $${amount.toFixed(4)} ${currency}`, 'dim')}`);
  }

  /** Log a success message with green checkmark. */
  success(message: string): void {
    if (!this.shouldLog('info')) return;
    console.log(`${this.prefix()} ${colorize(`✓ ${message}`, 'green')}`);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

/** Create a logger instance. */
export function getLogger(name: string, level: LogLevel = 'info'): PlatformLogger {
  return new PlatformLogger(name, level);
}
