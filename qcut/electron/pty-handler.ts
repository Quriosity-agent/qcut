import { ipcMain, app } from "electron";
import { platform } from "node:os";

// Dynamic import for node-pty to support packaged app
let pty: typeof import("node-pty");
try {
  pty = require("node-pty");
  console.log("[PTY] Loaded node-pty from standard path");
} catch (error) {
  console.warn("[PTY] Failed to load node-pty from standard path:", error);
  // In packaged app, load from extraResources
  const path = require("path");
  const modulePath = path.join(
    process.resourcesPath,
    "node_modules/node-pty"
  );
  try {
    pty = require(modulePath);
    console.log("[PTY] Loaded node-pty from production path:", modulePath);
  } catch (prodError) {
    console.error("[PTY] Failed to load node-pty from production path:", prodError);
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

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, PtySession>();

function generateSessionId(): string {
  return `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getShell(): string {
  if (platform() === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellArgs(): string[] {
  if (platform() === "win32") {
    return [];
  }
  return ["-l"]; // Login shell on Unix
}

// ============================================================================
// IPC Handlers
// ============================================================================

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
          console.log(`[PTY] Session ${session.id} killed (webContents destroyed)`);
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
        console.log(`[PTY] Dimensions: ${options.cols || 80}x${options.rows || 24}`);
        console.log(`[PTY] COMSPEC env: ${process.env.COMSPEC}`);
        console.log(`[PTY] SHELL env: ${process.env.SHELL}`);

        const ptyProcess = pty.spawn(shell, args, {
          name: "xterm-256color",
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: options.cwd || process.cwd(),
          env: {
            ...process.env,
            ...options.env, // Merge additional env vars (e.g., OPENROUTER_API_KEY)
          },
        });

        const session: PtySession = {
          id: sessionId,
          process: ptyProcess,
          webContentsId: event.sender.id,
        };

        sessions.set(sessionId, session);

        console.log(`[PTY] About to call pty.spawn()...`);

        // Forward PTY output to renderer
        ptyProcess.onData((data: string) => {
          // Log first 100 chars of data for debugging
          const preview = data.length > 100 ? data.substring(0, 100) + "..." : data;
          console.log(`[PTY] Data from ${sessionId}:`, preview.replace(/\r?\n/g, "\\n"));
          if (!event.sender.isDestroyed()) {
            event.sender.send("pty:data", { sessionId, data });
          }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`[PTY] ===== SESSION EXIT =====`);
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
        const message = error instanceof Error ? error.message : "PTY spawn failed";
        const stack = error instanceof Error ? error.stack : undefined;
        console.error("[PTY] ===== SPAWN ERROR =====");
        console.error("[PTY] Error message:", message);
        console.error("[PTY] Error stack:", stack);
        return { success: false, error: message };
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
        const message = error instanceof Error ? error.message : "PTY write failed";
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
        const message = error instanceof Error ? error.message : "PTY resize failed";
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
        const message = error instanceof Error ? error.message : "PTY kill failed";
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
