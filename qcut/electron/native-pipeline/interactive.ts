/**
 * Interactive Mode Utilities
 *
 * CI-safe interactive prompts and environment detection.
 * Ported from Python interactive.py.
 *
 * @module electron/native-pipeline/interactive
 */

import * as readline from "readline";

/** Environment variables that indicate a CI/non-interactive environment. */
const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "JENKINS_URL",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
] as const;

/**
 * Detect if the current environment is interactive (has a TTY).
 * Returns false in CI environments or when stdin is not a TTY.
 */
export function isInteractive(): boolean {
  for (const envVar of CI_ENV_VARS) {
    if (process.env[envVar]) return false;
  }
  return process.stdin.isTTY === true;
}

/**
 * Prompt the user for confirmation. Returns `defaultValue` in
 * non-interactive environments without blocking.
 */
export async function confirm(
  prompt: string,
  defaultValue = false
): Promise<boolean> {
  if (!isInteractive()) return defaultValue;

  const suffix = defaultValue ? " (Y/n): " : " (y/N): ";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(prompt + suffix, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) {
        resolve(defaultValue);
        return;
      }
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

/**
 * Read a value from stdin with hidden input (for secrets).
 * Falls back to reading from piped stdin in non-TTY environments.
 */
export async function readHiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Read from pipe/redirect (supports --stdin pattern)
    return new Promise<string>((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data.trim()));
      process.stdin.on("error", reject);
      process.stdin.resume();
    });
  }

  // TTY: use raw mode to hide input
  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    // Write prompt to stderr so it doesn't pollute stdout
    process.stderr.write(prompt);

    // Mute output by replacing _writeToOutput
    const originalWrite = (
      rl as unknown as { _writeToOutput: (...args: unknown[]) => void }
    )._writeToOutput;
    (
      rl as unknown as { _writeToOutput: (...args: unknown[]) => void }
    )._writeToOutput = () => {
      // Suppress echo
    };

    rl.question("", (answer) => {
      (
        rl as unknown as { _writeToOutput: (...args: unknown[]) => void }
      )._writeToOutput = originalWrite;
      rl.close();
      process.stderr.write("\n");
      resolve(answer.trim());
    });
  });
}
