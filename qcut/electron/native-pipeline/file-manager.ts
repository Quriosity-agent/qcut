/**
 * File Manager
 *
 * Async file operations: download, copy, move, delete, hash, list.
 * Provides a unified interface for file I/O across the pipeline.
 *
 * Ported from: utils/file_manager.py
 *
 * @module electron/native-pipeline/file-manager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

export class FileManager {
  readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.cwd();
  }

  /** Download a file from a URL to a local path. */
  async downloadFile(
    url: string,
    destination?: string,
    filename?: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    const destPath = destination ?? path.join(
      this.baseDir,
      filename ?? `download_${Date.now()}${guessExtFromUrl(url)}`,
    );

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return destPath;
  }

  /** Copy a file from source to destination. */
  async copyFile(source: string, destination: string): Promise<string> {
    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(source, destination);
    return destination;
  }

  /** Move a file from source to destination. */
  async moveFile(source: string, destination: string): Promise<string> {
    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.renameSync(source, destination);
    return destination;
  }

  /** Delete a file. Returns true if deleted, false if not found. */
  async deleteFile(filePath: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  /** Get file hash (md5, sha256, etc.). */
  async getFileHash(filePath: string, algorithm = 'md5'): Promise<string> {
    const content = fs.readFileSync(filePath);
    return crypto.createHash(algorithm).update(content).digest('hex');
  }

  /** Get file information. */
  async getFileInfo(filePath: string): Promise<FileInfo> {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      modified: stat.mtime,
      isDirectory: stat.isDirectory(),
    };
  }

  /** List files in a directory with optional pattern matching. */
  async listFiles(
    directory: string,
    pattern = '*',
    recursive = false,
  ): Promise<string[]> {
    const dir = path.resolve(this.baseDir, directory);
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        const subFiles = await this.listFiles(fullPath, pattern, true);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        if (pattern === '*' || matchGlob(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }

  /** Check if a file exists. */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /** Read file content as string. */
  readText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** Write string content to file. */
  writeText(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

/** Simple glob matching (supports * and ? wildcards). */
function matchGlob(filename: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(filename);
}

function guessExtFromUrl(url: string): string {
  const urlPath = url.split('?')[0];
  const ext = path.extname(urlPath);
  return ext || '.bin';
}
