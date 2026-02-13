import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSpawnDiagnostics,
  extractCommandBinary,
  resolveCommandOnPath,
} from "../pty-spawn-diagnostics";

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "qcut-pty-diagnostics-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("extractCommandBinary", () => {
  it("extracts binary from standard command", () => {
    const binary = extractCommandBinary({
      command: "claude --dangerously-skip-permissions",
    });

    expect(binary).toBe("claude");
  });

  it("extracts quoted binary path", () => {
    const binary = extractCommandBinary({
      command: '"/Applications/Claude Code.app/bin/claude" --model sonnet',
    });

    expect(binary).toBe("/Applications/Claude Code.app/bin/claude");
  });
});

describe("resolveCommandOnPath", () => {
  it("resolves executable command on unix-like path", () => {
    const tempDir = createTempDir();
    const commandPath = join(tempDir, "claude");
    writeFileSync(commandPath, "#!/bin/sh\necho ok\n");
    chmodSync(commandPath, 0o755);

    const resolvedPath = resolveCommandOnPath({
      commandBinary: "claude",
      envPath: tempDir,
      platformName: "darwin",
    });

    expect(resolvedPath).toBe(commandPath);
  });

  it("resolves command on windows path using PATHEXT", () => {
    const tempDir = createTempDir();
    const commandPath = join(tempDir, "claude.CMD");
    writeFileSync(commandPath, "@echo off\r\necho ok\r\n");

    const resolvedPath = resolveCommandOnPath({
      commandBinary: "claude",
      envPath: tempDir,
      platformName: "win32",
      pathExtEnv: ".EXE;.CMD;.BAT",
    });

    expect(resolvedPath).toBe(commandPath);
  });
});

describe("createSpawnDiagnostics", () => {
  it("returns spawn diagnostics with resolved command path and cwd status", () => {
    const tempDir = createTempDir();
    const commandPath = join(tempDir, "claude");
    writeFileSync(commandPath, "#!/bin/sh\necho ok\n");
    chmodSync(commandPath, 0o755);

    const diagnostics = createSpawnDiagnostics({
      shell: "/bin/zsh",
      args: ["-c", "claude --dangerously-skip-permissions"],
      cwd: tempDir,
      command: "claude --dangerously-skip-permissions",
      envPath: tempDir,
      platformName: "darwin",
    });

    expect(diagnostics.cwdExists).toBe(true);
    expect(diagnostics.commandBinary).toBe("claude");
    expect(diagnostics.resolvedCommandPath).toBe(commandPath);
    expect(diagnostics.pathPreview).toBe(tempDir);
  });
});
