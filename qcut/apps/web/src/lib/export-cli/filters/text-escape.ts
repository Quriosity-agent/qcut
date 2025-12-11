/**
 * FFmpeg Text Escape Utilities
 *
 * Pure functions for escaping text and paths for FFmpeg filter arguments.
 * Extracted from export-engine-cli.ts lines 89-137.
 */

/**
 * Escape special characters for FFmpeg drawtext filter.
 * FFmpeg drawtext uses ':' as delimiter and requires escaping for special chars.
 *
 * Characters escaped (in order):
 * - '\' -> '\\' (backslashes first)
 * - ':' -> '\:' (filter delimiter)
 * - '[' -> '\[' (bracket)
 * - ']' -> '\]' (bracket)
 * - ',' -> '\,' (filter separator)
 * - ';' -> '\;' (semicolon)
 * - "'" -> "\'" (single quote)
 * - '%' -> '\%' (expansion tokens)
 * - '\n' -> '\\n' (newlines to literal)
 * - '\r' -> '' (remove carriage returns)
 * - '=' -> '\=' (equals sign)
 *
 * @param text - Raw text content to escape
 * @returns FFmpeg-safe escaped string
 */
export function escapeTextForFFmpeg(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/:/g, "\\:") // Escape colons (filter delimiter)
    .replace(/\[/g, "\\[") // Escape opening brackets
    .replace(/\]/g, "\\]") // Escape closing brackets
    .replace(/,/g, "\\,") // Escape commas (filter separator)
    .replace(/;/g, "\\;") // Escape semicolons
    .replace(/'/g, "\\'") // Escape single quotes
    .replace(/%/g, "\\%") // Escape percent signs (expansion tokens)
    .replace(/\n/g, "\\n") // Convert newlines to literal \n
    .replace(/\r/g, "") // Remove carriage returns
    .replace(/=/g, "\\="); // Escape equals signs
}

/**
 * Escape file system paths for FFmpeg filter arguments.
 * Ensures separators, spaces, and delimiters are properly escaped.
 *
 * @param path - File system path to escape
 * @returns FFmpeg-safe escaped path
 */
export function escapePathForFFmpeg(path: string): string {
  return path
    .replace(/\\/g, "\\\\") // Windows backslashes
    .replace(/:/g, "\\:") // Drive letter separator
    .replace(/ /g, "\\ ") // Spaces in path segments
    .replace(/,/g, "\\,") // Filter delimiters
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/=/g, "\\=");
}

/**
 * Convert CSS hex color to FFmpeg format (0xRRGGBB).
 *
 * @param hexColor - CSS color string (e.g., "#ffffff" or "ffffff")
 * @returns FFmpeg color format (e.g., "0xffffff")
 */
export function colorToFFmpeg(hexColor: string): string {
  const hex = hexColor.startsWith("#") ? hexColor.substring(1) : hexColor;
  return `0x${hex}`;
}
