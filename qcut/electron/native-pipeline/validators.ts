/**
 * Configuration and Input Validators
 *
 * Validates pipeline configs, file paths, URLs, and API keys.
 *
 * Ported from: utils/validators.py
 *
 * @module electron/native-pipeline/validators
 */

import * as fs from 'fs';
import * as path from 'path';
import { ValidationError, ConfigurationError } from './errors.js';
import type { PipelineStep } from './executor.js';

// -- Config Validator --

export interface PipelineConfig {
  name?: string;
  steps: PipelineStep[];
  outputDir?: string;
  globalConfig?: Record<string, unknown>;
}

export class ConfigValidator {
  /** Validate a full pipeline configuration. */
  validatePipelineConfig(config: PipelineConfig): boolean {
    this.validateRequiredFields(config);
    this.validateSteps(config.steps);
    if (config.outputDir) {
      this.validateOutputDirectory(config.outputDir);
    }
    if (config.globalConfig) {
      this.validateGlobalConfig(config.globalConfig);
    }
    return true;
  }

  private validateRequiredFields(config: PipelineConfig): void {
    if (!config.steps || !Array.isArray(config.steps)) {
      throw new ConfigurationError('Pipeline config must have a "steps" array');
    }
    if (config.steps.length === 0) {
      throw new ConfigurationError('Pipeline must have at least one step');
    }
  }

  private validateSteps(steps: PipelineStep[]): void {
    for (let i = 0; i < steps.length; i++) {
      this.validateStepConfig(steps[i], i);
    }
  }

  private validateStepConfig(step: PipelineStep, index: number): void {
    if (!step.type) {
      throw new ConfigurationError(`Step ${index}: missing "type" field`);
    }
    if (!step.model) {
      throw new ConfigurationError(`Step ${index}: missing "model" field`);
    }
    this.validateStepParameters(step, index);
  }

  private validateStepParameters(step: PipelineStep, index: number): void {
    if (step.params) {
      if (typeof step.params !== 'object' || Array.isArray(step.params)) {
        throw new ConfigurationError(
          `Step ${index}: "params" must be an object`,
        );
      }
    }
  }

  private validateOutputDirectory(outputDir: string): void {
    const dir = path.resolve(outputDir);
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) {
      throw new ConfigurationError(
        `Output directory parent does not exist: ${parent}`,
      );
    }
  }

  private validateGlobalConfig(config: Record<string, unknown>): void {
    if (config.cost_limit !== undefined) {
      if (typeof config.cost_limit !== 'number' || config.cost_limit <= 0) {
        throw new ConfigurationError('cost_limit must be a positive number');
      }
    }
    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number' || config.timeout <= 0) {
        throw new ConfigurationError('timeout must be a positive number');
      }
    }
  }
}

// -- Input Validator --

export class InputValidator {
  /** Validate that a file path exists and is a file. */
  validateFilePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new ValidationError(`File not found: ${filePath}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new ValidationError(`Not a file: ${filePath}`);
    }
    return resolved;
  }

  /** Validate that a URL is well-formed. */
  validateUrl(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError(`Invalid URL: ${url}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError(`URL must use http or https: ${url}`);
    }
    return url;
  }

  /** Validate that an API key is non-empty and reasonable. */
  validateApiKey(apiKey: string, serviceName: string): string {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ValidationError(`API key for ${serviceName} is empty`);
    }
    if (apiKey.length < 10) {
      throw new ValidationError(
        `API key for ${serviceName} seems too short (${apiKey.length} chars)`,
      );
    }
    return apiKey.trim();
  }

  /** Validate that a number is positive. */
  validatePositiveNumber(value: number, name: string): number {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${name} must be a number`);
    }
    if (value <= 0) {
      throw new ValidationError(`${name} must be positive, got ${value}`);
    }
    return value;
  }

  /** Validate that a directory exists or can be created. */
  validateDirectory(dirPath: string): string {
    const resolved = path.resolve(dirPath);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        throw new ValidationError(`Not a directory: ${dirPath}`);
      }
    }
    return resolved;
  }

  /** Validate media file by extension. */
  validateMediaFile(
    filePath: string,
    allowedExtensions: string[],
  ): string {
    const resolved = this.validateFilePath(filePath);
    const ext = path.extname(resolved).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new ValidationError(
        `Unsupported file type: ${ext}. Allowed: ${allowedExtensions.join(', ')}`,
      );
    }
    return resolved;
  }
}

// Singleton instances
export const configValidator = new ConfigValidator();
export const inputValidator = new InputValidator();
