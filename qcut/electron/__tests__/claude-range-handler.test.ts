import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "documents") return "/mock/Documents";
      if (name === "temp") return "/mock/temp";
      return "/mock/unknown";
    }),
    getVersion: vi.fn(() => "0.0.1-test"),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ipcMain, BrowserWindow } from "electron";
import {
  executeDeleteRange,
  validateRangeDeleteRequest,
} from "../claude/claude-range-handler";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claude-range-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateRangeDeleteRequest", () => {
    it("rejects non-number startTime", () => {
      expect(() =>
        validateRangeDeleteRequest({
          startTime: "a" as unknown as number,
          endTime: 5,
        })
      ).toThrow("must be numbers");
    });

    it("rejects negative times", () => {
      expect(() =>
        validateRangeDeleteRequest({ startTime: -1, endTime: 5 })
      ).toThrow("non-negative");
    });

    it("rejects startTime >= endTime", () => {
      expect(() =>
        validateRangeDeleteRequest({ startTime: 10, endTime: 5 })
      ).toThrow("must be less than endTime");
    });

    it("rejects non-array trackIds", () => {
      expect(() =>
        validateRangeDeleteRequest({
          startTime: 1,
          endTime: 5,
          trackIds: "track1" as unknown as string[],
        })
      ).toThrow("must be an array");
    });

    it("accepts valid request", () => {
      expect(() =>
        validateRangeDeleteRequest({ startTime: 1, endTime: 5 })
      ).not.toThrow();
    });

    it("accepts request with trackIds", () => {
      expect(() =>
        validateRangeDeleteRequest({
          startTime: 0,
          endTime: 10,
          trackIds: ["t1", "t2"],
        })
      ).not.toThrow();
    });
  });

  describe("executeDeleteRange", () => {
    it("sends IPC request and resolves on response", async () => {
      const send = vi.fn();
      const mockWindow = {
        webContents: { send },
      } as unknown as BrowserWindow;

      let ipcCallback: (event: unknown, data: unknown) => void = () => {};
      vi.mocked(ipcMain.on).mockImplementation((channel, callback) => {
        if (channel === "claude:timeline:deleteRange:response") {
          ipcCallback = callback as typeof ipcCallback;
        }
        return ipcMain;
      });

      const promise = executeDeleteRange(mockWindow, {
        startTime: 5,
        endTime: 10,
        ripple: true,
      });

      expect(send).toHaveBeenCalledWith(
        "claude:timeline:deleteRange",
        expect.objectContaining({
          request: {
            startTime: 5,
            endTime: 10,
            ripple: true,
          },
        })
      );

      const sentData = send.mock.calls[0][1] as { requestId: string };

      ipcCallback(
        {},
        {
          requestId: sentData.requestId,
          result: {
            deletedElements: 2,
            splitElements: 1,
            totalRemovedDuration: 5,
          },
        }
      );

      const result = await promise;
      expect(result.deletedElements).toBe(2);
      expect(result.splitElements).toBe(1);
      expect(result.totalRemovedDuration).toBe(5);
    });

    it("passes trackIds filter to renderer", async () => {
      const send = vi.fn();
      const mockWindow = {
        webContents: { send },
      } as unknown as BrowserWindow;

      let ipcCallback: (event: unknown, data: unknown) => void = () => {};
      vi.mocked(ipcMain.on).mockImplementation((channel, callback) => {
        if (channel === "claude:timeline:deleteRange:response") {
          ipcCallback = callback as typeof ipcCallback;
        }
        return ipcMain;
      });

      const promise = executeDeleteRange(mockWindow, {
        startTime: 0,
        endTime: 5,
        trackIds: ["track_a", "track_b"],
      });

      expect(send).toHaveBeenCalledWith(
        "claude:timeline:deleteRange",
        expect.objectContaining({
          request: expect.objectContaining({
            trackIds: ["track_a", "track_b"],
          }),
        })
      );

      const sentData = send.mock.calls[0][1] as { requestId: string };
      ipcCallback(
        {},
        {
          requestId: sentData.requestId,
          result: {
            deletedElements: 0,
            splitElements: 0,
            totalRemovedDuration: 0,
          },
        }
      );

      await promise;
    });

    it("rejects on validation error before sending IPC", async () => {
      const mockWindow = {
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow;

      await expect(
        executeDeleteRange(mockWindow, { startTime: 10, endTime: 5 })
      ).rejects.toThrow("must be less than endTime");

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });
});
