"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

/**
 * Props for the TerminalEmulator component.
 */
interface TerminalEmulatorProps {
  /** PTY session ID to connect to, null if not connected */
  sessionId: string | null;
  /** Callback fired when terminal is initialized and ready */
  onReady?: () => void;
}

/**
 * Terminal emulator component using xterm.js.
 * Provides a full terminal experience with ANSI color support, clipboard operations,
 * and automatic resizing. Connects to a PTY session via Electron IPC.
 */
export function TerminalEmulator({
  sessionId,
  onReady,
}: TerminalEmulatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { setDimensions, resize, handleDisconnected } = usePtyTerminalStore();

  // Handle terminal output
  const handleData = useCallback(
    (data: { sessionId: string; data: string }) => {
      if (data.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(data.data);
      }
    },
    [sessionId]
  );

  // Handle terminal exit
  const handleExit = useCallback(
    (data: { sessionId: string; exitCode: number }) => {
      if (data.sessionId === sessionId) {
        if (terminalRef.current) {
          terminalRef.current.write(
            `\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`
          );
        }
        handleDisconnected(data.exitCode);
      }
    },
    [sessionId, handleDisconnected]
  );

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#ffffff",
        cursorAccent: "#000000",
        selectionBackground: "#5c5c5c",
        black: "#000000",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#abb2bf",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    terminal.open(containerRef.current);

    // Small delay to ensure container is rendered before fitting
    setTimeout(() => {
      fitAddon.fit();
      setDimensions(terminal.cols, terminal.rows);
    }, 0);

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle user input - send to PTY
    terminal.onData((data) => {
      if (sessionId) {
        window.electronAPI?.pty?.write?.(sessionId, data)?.catch((error) => {
          console.error("[Terminal] Failed to write to PTY:", error);
        });
      }
    });

    // Track if we're currently pasting to prevent double onData
    let isPasting = false;

    // Handle keyboard shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      // Handle paste (Ctrl+V / Cmd+V)
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "v" &&
        event.type === "keydown"
      ) {
        if (isPasting) {
          return false;
        }
        isPasting = true;
        // Reset after a short delay
        setTimeout(() => {
          isPasting = false;
        }, 100);

        // Guard against clipboard API unavailability
        if (!navigator.clipboard?.readText) {
          return true;
        }
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && sessionId) {
              // Write directly to PTY, bypassing terminal.paste()
              window.electronAPI?.pty?.write?.(sessionId, text);
            }
          })
          .catch((err) => {
            console.error("[Terminal] Failed to read clipboard:", err);
          });
        // Prevent xterm from also handling paste
        return false;
      }

      // Check for copy shortcut (Ctrl+C / Cmd+C) when there's a selection
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "c" &&
        event.type === "keydown" &&
        terminal.hasSelection()
      ) {
        // Guard against clipboard API unavailability (non-secure contexts, tests)
        if (!navigator.clipboard?.writeText) {
          return true;
        }
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.error("[Terminal] Failed to copy:", err);
          });
        }
        // Return false to prevent sending Ctrl+C to terminal when copying
        return false;
      }
      // Allow all other keys
      return true;
    });

    // Setup IPC listeners for PTY data
    window.electronAPI?.pty?.onData(handleData);
    window.electronAPI?.pty?.onExit(handleExit);

    // Notify ready
    onReady?.();

    // Cleanup
    return () => {
      window.electronAPI?.pty?.removeListeners();
      terminal.dispose();
    };
  }, [sessionId, handleData, handleExit, setDimensions, onReady]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current || !terminalRef.current) {
      return;
    }

    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;

    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to batch resize operations
      requestAnimationFrame(() => {
        if (fitAddon && terminal) {
          try {
            fitAddon.fit();
            setDimensions(terminal.cols, terminal.rows);
            resize().catch(() => {
              // Ignore resize errors (e.g., during unmount or when PTY unavailable)
            });
          } catch {
            // Ignore resize errors during unmount
          }
        }
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [setDimensions, resize]);

  // Focus terminal when sessionId changes (new connection)
  useEffect(() => {
    if (sessionId && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full [&_.xterm]:h-full [&_.xterm-viewport]:!bg-[#1a1a1a] [&_.xterm-screen]:!bg-[#1a1a1a]"
      style={{ backgroundColor: "#1a1a1a" }}
      role="application"
      aria-label="Terminal emulator"
    />
  );
}
