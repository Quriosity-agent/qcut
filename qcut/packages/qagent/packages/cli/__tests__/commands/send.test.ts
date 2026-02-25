import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockTmux, mockExec, mockDetectActivity } = vi.hoisted(() => ({
  mockTmux: vi.fn(),
  mockExec: vi.fn(),
  mockDetectActivity: vi.fn(),
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: mockTmux,
  exec: mockExec,
  execSilent: vi.fn(),
  git: vi.fn(),
  gh: vi.fn(),
}));

vi.mock("../../src/lib/plugins.js", () => ({
  getAgent: () => ({
    name: "claude-code",
    processName: "claude",
    detectActivity: mockDetectActivity,
  }),
  getAgentByName: () => ({
    name: "claude-code",
    processName: "claude",
    detectActivity: mockDetectActivity,
  }),
}));

vi.mock("../../src/lib/session-utils.js", () => ({
  findProjectForSession: () => null,
}));

vi.mock("@composio/ao-core", () => ({
  loadConfig: () => {
    throw new Error("no config");
  },
}));

import { Command } from "commander";
import { registerSend } from "../../src/commands/send.js";

let program: Command;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  program = new Command();
  program.exitOverride();
  registerSend(program);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  mockTmux.mockReset();
  mockExec.mockReset();
  mockDetectActivity.mockReset();
  mockExec.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  vi.useRealTimers();
  consoleSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  exitSpy.mockRestore();
});

describe("send command", () => {
  describe("session existence check", () => {
    it("exits with error when session does not exist", async () => {
      mockTmux.mockResolvedValue(null); // has-session fails

      await expect(
        program.parseAsync(["node", "test", "send", "nonexistent", "hello"]),
      ).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
    });
  });

  describe("busy detection", () => {
    it("detects idle session via agent plugin", async () => {
      // has-session succeeds
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") {
          const sIdx = args.indexOf("-S");
          if (sIdx >= 0 && args[sIdx + 1] === "-5") return "some output\n❯ ";
          if (sIdx >= 0 && args[sIdx + 1] === "-10") return "esc to interrupt\nThinking";
          return "";
        }
        return "";
      });

      // Agent detects idle for wait-for-idle, then active for verification
      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle check
        .mockReturnValueOnce("active"); // verification check

      await program.parseAsync(["node", "test", "send", "my-session", "hello", "world"]);

      // Should have sent keys with -l (literal) flag
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "my-session",
        "-l",
        "hello world",
      ]);
      // Should have sent Enter
      expect(mockExec).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "my-session", "Enter"]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Message sent and processing"),
      );
    });

    it("detects busy session and waits via agent plugin", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "some output";
        return "";
      });

      // First call: active (busy), second call: idle, third call: active (verification)
      mockDetectActivity
        .mockReturnValueOnce("active") // busy
        .mockReturnValueOnce("idle") // now idle
        .mockReturnValueOnce("active"); // verification: processing

      await program.parseAsync(["node", "test", "send", "my-session", "fix", "the", "bug"]);

      // Should have eventually sent the message
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "my-session",
        "-l",
        "fix the bug",
      ]);
    });

    it("skips busy detection with --no-wait", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "Thinking\nesc to interrupt";
        return "";
      });

      // Agent detects active for verification
      mockDetectActivity.mockReturnValue("active");

      await program.parseAsync(["node", "test", "send", "--no-wait", "my-session", "urgent"]);

      // Should have sent the message without waiting
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "my-session",
        "-l",
        "urgent",
      ]);
    });

    it("detects queued message state", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") {
          const sIdx = args.indexOf("-S");
          if (sIdx >= 0 && args[sIdx + 1] === "-5") return "Output\n❯ ";
          if (sIdx >= 0 && args[sIdx + 1] === "-10")
            return "Output\nPress up to edit queued messages";
          return "";
        }
        return "";
      });

      // Agent detects idle for wait-for-idle, then idle for verification (not processing)
      mockDetectActivity.mockReturnValue("idle");

      await program.parseAsync(["node", "test", "send", "my-session", "hello"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Message queued"));
    });
  });

  describe("message delivery", () => {
    it("uses load-buffer for long messages", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      const longMsg = "x".repeat(250);
      await program.parseAsync(["node", "test", "send", "my-session", longMsg]);

      // Should have used load-buffer for long message
      expect(mockExec).toHaveBeenCalledWith("tmux", expect.arrayContaining(["load-buffer"]));
      expect(mockExec).toHaveBeenCalledWith("tmux", expect.arrayContaining(["paste-buffer"]));
    });

    it("uses send-keys for short messages", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      await program.parseAsync(["node", "test", "send", "my-session", "short", "msg"]);

      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "my-session",
        "-l",
        "short msg",
      ]);
    });

    it("clears partial input before sending", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      await program.parseAsync(["node", "test", "send", "my-session", "hello"]);

      // C-u should be called to clear input
      expect(mockExec).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "my-session", "C-u"]);
    });
  });
});
