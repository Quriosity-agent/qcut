import { ipcMain, app } from "electron";
import { platform } from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSpawnDiagnostics } from "./pty-spawn-diagnostics";

// Logger: use electron-log if available, fallback to console
let log: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  log = require("electron-log");
} catch {
  log = console;
}

// Dynamic import for node-pty to support packaged app
let pty: typeof import("node-pty");
try {
  pty = require("node-pty");
  console.log("[PTY] Loaded node-pty from standard path");
} catch (error) {
  console.warn("[PTY] Failed to load node-pty from standard path:", error);
  // In packaged app, load from extraResources
  const modulePath = path.join(process.resourcesPath, "node_modules/node-pty");
  try {
    pty = require(modulePath);
    console.log("[PTY] Loaded node-pty from production path:", modulePath);
  } catch (prodError) {
    console.error(
      "[PTY] Failed to load node-pty from production path:",
      prodError
    );
    throw new Error("Failed to load node-pty module");
  }
}

// ============================================================================
// Types
// ============================================================================

interface PtySession {
  id: string;
  process: import("node-pty").IPty;
  webContentsId: number;
}

interface SpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  command?: string; // e.g., "npx @google/gemini-cli"
  env?: Record<string, string>; // Additional environment variables (e.g., OPENROUTER_API_KEY)
}

interface SpawnResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

interface OperationResult {
  success: boolean;
  error?: string;
}

/** Return a recovery hint message for common PTY spawn errors. */
function getPtySpawnRecoveryHint({
  message,
}: {
  message: string;
}): string | null {
  const normalizedMessage = message.toLowerCase();
  const hasAbiSignature =
    normalizedMessage.includes("posix_spawnp failed") ||
    normalizedMessage.includes("node_module_version") ||
    normalizedMessage.includes("module version mismatch");

  if (!hasAbiSignature) {
    return null;
  }

  return "node-pty may be built for a different ABI. Run: npx electron-rebuild -f -w node-pty";
}

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, PtySession>();

/** Generate a unique PTY session identifier. */
function generateSessionId(): string {
  return `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Determine the default shell executable for the current platform. */
function getShell(): string {
  if (platform() === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

/** Return default shell arguments for the current platform. */
function getShellArgs(): string[] {
  if (platform() === "win32") {
    return [];
  }
  return ["-l"]; // Login shell on Unix
}

/** Locate the QCut MCP server entry point in dev or packaged paths. */
function resolveQcutMcpServerEntry(): string | null {
  const candidates = [
    path.resolve(__dirname, "mcp", "qcut-mcp-server.js"),
    path.resolve(
      app.getAppPath(),
      "dist",
      "electron",
      "mcp",
      "qcut-mcp-server.js"
    ),
    path.resolve(app.getAppPath(), "electron", "mcp", "qcut-mcp-server.js"),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible paths and continue searching.
    }
  }

  return null;
}

/** Parse existing CLAUDE_MCP_SERVERS JSON config or return empty object. */
function parseMcpServerConfig({
  rawConfig,
}: {
  rawConfig?: string;
}): Record<string, unknown> {
  if (!rawConfig) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawConfig);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid existing config is ignored and replaced with a valid object.
  }
  return {};
}

/** Build the CLAUDE_MCP_SERVERS env variable with the QCut server injected. */
function buildClaudeMcpServersEnv({
  existingRawConfig,
  mcpServerPath,
  projectId,
  projectRoot,
  apiBaseUrl,
}: {
  existingRawConfig?: string;
  mcpServerPath: string;
  projectId?: string;
  projectRoot?: string;
  apiBaseUrl?: string;
}): string {
  const existingConfig = parseMcpServerConfig({ rawConfig: existingRawConfig });
  const qcutEnv: Record<string, string> = {};

  if (projectId) {
    qcutEnv.QCUT_PROJECT_ID = projectId;
  }
  if (projectRoot) {
    qcutEnv.QCUT_PROJECT_ROOT = projectRoot;
  }
  if (apiBaseUrl) {
    qcutEnv.QCUT_API_BASE_URL = apiBaseUrl;
  }

  const qcutConfig = {
    command: "node",
    args: [mcpServerPath],
    env: qcutEnv,
  };

  return JSON.stringify({
    ...existingConfig,
    qcut: qcutConfig,
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

/** Register all PTY-related IPC handlers for terminal session management. */
export function setupPtyIPC(): void {
  console.log("[PTY] Setting up PTY IPC handlers...");
  console.log("[PTY] Platform:", platform());
  console.log("[PTY] node-pty loaded:", pty ? "YES" : "NO");

  // Clean up PTY sessions when renderer crashes or is destroyed
  app.on("web-contents-created", (_, contents) => {
    contents.on("destroyed", () => {
      const contentsId = contents.id;
      const sessionsToKill = Array.from(sessions.values()).filter(
        (s) => s.webContentsId === contentsId
      );

      if (sessionsToKill.length > 0) {
        console.log(
          `[PTY] Cleaning up ${sessionsToKill.length} sessions for destroyed webContents ${contentsId}`
        );
      }

      for (const session of sessionsToKill) {
        try {
          session.process.kill();
          sessions.delete(session.id);
          console.log(
            `[PTY] Session ${session.id} killed (webContents destroyed)`
          );
        } catch {
          // Ignore errors during cleanup
        }
      }
    });
  });

  // Spawn a new PTY session
  ipcMain.handle(
    "pty:spawn",
    async (event, options: SpawnOptions = {}): Promise<SpawnResult> => {
      console.log("[PTY] ===== SPAWN REQUEST =====");
      console.log("[PTY] Options received:", JSON.stringify(options, null, 2));

      try {
        const sessionId = generateSessionId();

        // Determine shell and arguments
        let shell: string;
        let args: string[];

        if (options.command) {
          // Custom command (e.g., "npx @google/gemini-cli")
          console.log("[PTY] Custom command mode:", options.command);
          if (platform() === "win32") {
            shell = process.env.COMSPEC || "cmd.exe";
            args = ["/c", options.command];
          } else {
            shell = getShell();
            args = ["-c", options.command];
          }
        } else {
          // Default shell
          console.log("[PTY] Default shell mode");
          shell = getShell();
          args = getShellArgs();
        }

        console.log(`[PTY] Spawning session ${sessionId}`);
        console.log(`[PTY] Shell: ${shell}`);
        console.log(`[PTY] Args: ${JSON.stringify(args)}`);
        console.log(`[PTY] CWD: ${options.cwd || process.cwd()}`);
        console.log(
          `[PTY] Dimensions: ${options.cols || 80}x${options.rows || 24}`
        );
        console.log(`[PTY] COMSPEC env: ${process.env.COMSPEC}`);
        console.log(`[PTY] SHELL env: ${process.env.SHELL}`);

        const spawnCwd = options.cwd || process.cwd();
        const spawnEnv: NodeJS.ProcessEnv = {
          ...process.env,
          ...options.env, // Merge additional env vars (e.g., OPENROUTER_API_KEY)
        };

        const isClaudeCommand =
          typeof options.command === "string" &&
          options.command.trim().startsWith("claude");

        if (isClaudeCommand) {
          const mcpServerPath = resolveQcutMcpServerEntry();
          if (mcpServerPath) {
            spawnEnv.CLAUDE_MCP_SERVERS = buildClaudeMcpServersEnv({
              existingRawConfig: spawnEnv.CLAUDE_MCP_SERVERS,
              mcpServerPath,
              projectId: options.env?.QCUT_PROJECT_ID,
              projectRoot: options.env?.QCUT_PROJECT_ROOT || spawnCwd,
              apiBaseUrl: options.env?.QCUT_API_BASE_URL,
            });
          } else {
            log.warn(
              "[PTY] QCut MCP server entry not found; skipping MCP wiring"
            );
          }
        }

        const diagnostics = createSpawnDiagnostics({
          shell,
          args,
          cwd: spawnCwd,
          command: options.command,
          envPath: spawnEnv.PATH,
          platformName: platform(),
          pathExtEnv: spawnEnv.PATHEXT,
        });

        console.log(
          `[PTY] Spawning: shell="${diagnostics.shell}" args=${JSON.stringify(
            diagnostics.args
          )}`
        );
        console.log(
          `[PTY] CWD exists: ${diagnostics.cwdExists} (${diagnostics.cwd})`
        );
        console.log(`[PTY] PATH preview: ${diagnostics.pathPreview}`);
        if (diagnostics.commandBinary) {
          const resolvedCommandPath =
            diagnostics.resolvedCommandPath || "NOT FOUND";
          console.log(
            `[PTY] command ${diagnostics.commandBinary}: ${resolvedCommandPath}`
          );
        }

        const ptyProcess = pty.spawn(shell, args, {
          name: "xterm-256color",
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: spawnCwd,
          env: spawnEnv,
        });

        const session: PtySession = {
          id: sessionId,
          process: ptyProcess,
          webContentsId: event.sender.id,
        };

        sessions.set(sessionId, session);

        console.log("[PTY] About to call pty.spawn()...");

        // Forward PTY output to renderer
        ptyProcess.onData((data: string) => {
          // Log first 100 chars of data for debugging
          const preview =
            data.length > 100 ? data.substring(0, 100) + "..." : data;
          console.log(
            `[PTY] Data from ${sessionId}:`,
            preview.replace(/\r?\n/g, "\\n")
          );
          if (!event.sender.isDestroyed()) {
            event.sender.send("pty:data", { sessionId, data });
          }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log("[PTY] ===== SESSION EXIT =====");
          console.log(`[PTY] Session: ${sessionId}`);
          console.log(`[PTY] Exit code: ${exitCode}`);
          console.log(`[PTY] Signal: ${signal}`);
          if (!event.sender.isDestroyed()) {
            event.sender.send("pty:exit", { sessionId, exitCode, signal });
          }
          sessions.delete(sessionId);
        });

        console.log(`[PTY] Session ${sessionId} started successfully`);
        console.log(`[PTY] Active sessions: ${sessions.size}`);
        return { success: true, sessionId };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "PTY spawn failed";
        const stack = error instanceof Error ? error.stack : undefined;
        const code =
          error && typeof error === "object" && "code" in error
            ? (error as { code: string }).code
            : "none";
        const errno =
          error && typeof error === "object" && "errno" in error
            ? (error as { errno: number }).errno
            : "none";
        console.error("[PTY] ===== SPAWN ERROR =====");
        console.error("[PTY] Error message:", message);
        console.error("[PTY] Error code:", code, "errno:", errno);
        console.error("[PTY] Error stack:", stack);
        console.error("[PTY] Shell env SHELL:", process.env.SHELL);
        console.error("[PTY] Platform:", platform());
        const recoveryHint = getPtySpawnRecoveryHint({ message });
        const errorMessage = recoveryHint
          ? `${message}. ${recoveryHint}`
          : message;
        return { success: false, error: errorMessage };
      }
    }
  );

  // Write data to PTY
  ipcMain.handle(
    "pty:write",
    async (_, sessionId: string, data: string): Promise<OperationResult> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.write(data);
        return { success: true };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "PTY write failed";
        console.error(`[PTY] Write error for session ${sessionId}:`, message);
        return { success: false, error: message };
      }
    }
  );

  // Resize PTY
  ipcMain.handle(
    "pty:resize",
    async (
      _,
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<OperationResult> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.resize(cols, rows);
        console.log(`[PTY] Session ${sessionId} resized to ${cols}x${rows}`);
        return { success: true };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "PTY resize failed";
        console.error(`[PTY] Resize error for session ${sessionId}:`, message);
        return { success: false, error: message };
      }
    }
  );

  // Kill PTY session
  ipcMain.handle(
    "pty:kill",
    async (_, sessionId: string): Promise<OperationResult> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.kill();
        sessions.delete(sessionId);
        console.log(`[PTY] Session ${sessionId} killed`);
        return { success: true };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "PTY kill failed";
        console.error(`[PTY] Kill error for session ${sessionId}:`, message);
        return { success: false, error: message };
      }
    }
  );

  // Kill all sessions (for cleanup on app quit)
  ipcMain.handle("pty:kill-all", async (): Promise<{ success: boolean }> => {
    console.log(`[PTY] Killing all ${sessions.size} sessions`);
    for (const [sessionId, session] of sessions) {
      try {
        session.process.kill();
        console.log(`[PTY] Session ${sessionId} killed (cleanup)`);
      } catch {
        // Ignore errors during cleanup
      }
    }
    sessions.clear();
    return { success: true };
  });

  console.log("[PTY] Handler registered");
}

// Cleanup on app quit - call this from main.ts
/** Kill all active PTY sessions on app quit. */
export function cleanupPtySessions(): void {
  console.log(`[PTY] Cleaning up ${sessions.size} sessions on app quit`);
  for (const [sessionId, session] of sessions) {
    try {
      session.process.kill();
      console.log(`[PTY] Session ${sessionId} killed (app quit)`);
    } catch {
      // Ignore
    }
  }
  sessions.clear();
}
