import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

type IpcHandler = (...args: unknown[]) => Promise<unknown> | unknown;

type ExecOptions = {
  timeout?: number;
  windowsHide?: boolean;
};

type ExecBehavior = {
  stdout?: string;
  stderr?: string;
  error?: string;
};

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void;

type ExecMock = ((
  command: string,
  options: ExecOptions,
  callback: ExecCallback
) => void) & {
  [key: symbol]:
    | ((
        command: string,
        options: ExecOptions
      ) => Promise<{ stdout: string; stderr: string }>)
    | undefined;
};

// Force legacy binary pipeline for these tests (they test spawn/binary behavior)
const _envSetup = vi.hoisted(() => {
  process.env.QCUT_NATIVE_PIPELINE = "false";
});

vi.mock("../native-pipeline/index.js", () => ({
  NativePipelineManager: class {},
}));

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const execBehaviors = new Map<string, ExecBehavior>();

  const state = {
    isPackaged: true,
    handlers,
    execBehaviors,
    execCalls: [] as string[],
    binaryStatus: {
      name: "aicp",
      available: false,
      version: "1.0.0",
      path: null,
      checksumValid: false,
      compatible: false,
      updateAvailable: false,
      features: {},
      error: "Binary file not found",
    },
    decryptedKeys: {
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    },
  };

  const mockExec: ExecMock = ((command, _options, callback) => {
    state.execCalls.push(command);
    const behavior = state.execBehaviors.get(command);
    if (!behavior || behavior.error) {
      callback(new Error(behavior?.error || "command not found"), "", "");
      return;
    }

    callback(null, behavior.stdout || "", behavior.stderr || "");
  }) as ExecMock;

  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  mockExec[promisifyCustom] = async (command) => {
    state.execCalls.push(command);
    const behavior = state.execBehaviors.get(command);
    if (!behavior || behavior.error) {
      throw new Error(behavior?.error || "command not found");
    }

    return {
      stdout: behavior.stdout || "",
      stderr: behavior.stderr || "",
    };
  };

  const mockGetDecryptedApiKeys = vi.fn(async () => state.decryptedKeys);
  const mockImportMediaFile = vi.fn(async () => null);

  return {
    state,
    mockExec,
    mockSpawn: vi.fn(
      () =>
        ({
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
        }) as unknown as ChildProcess
    ),
    mockGetDecryptedApiKeys,
    mockImportMediaFile,
    mockBinaryManager: {
      reloadManifest: vi.fn(),
      getBinaryStatus: vi.fn(() => state.binaryStatus),
    },
    mockIpcHandle: vi.fn((channel: string, handler: IpcHandler) => {
      state.handlers.set(channel, handler);
    }),
    mockAppOn: vi.fn(),
  };
});

vi.mock("child_process", () => ({
  default: { exec: mocks.mockExec, spawn: mocks.mockSpawn },
  exec: mocks.mockExec,
  spawn: mocks.mockSpawn,
}));

vi.mock("node:child_process", () => ({
  default: { exec: mocks.mockExec, spawn: mocks.mockSpawn },
  exec: mocks.mockExec,
  spawn: mocks.mockSpawn,
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.3.67",
    getPath: () => "/tmp",
    get isPackaged() {
      return mocks.state.isPackaged;
    },
    on: mocks.mockAppOn,
  },
  ipcMain: {
    handle: mocks.mockIpcHandle,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock("../binary-manager.js", () => ({
  getBinaryManager: () => mocks.mockBinaryManager,
}));

vi.mock("../api-key-handler.js", () => ({
  getDecryptedApiKeys: mocks.mockGetDecryptedApiKeys,
}));

vi.mock("../claude/claude-media-handler.js", () => ({
  importMediaFile: mocks.mockImportMediaFile,
}));

import { cleanupAIPipeline, setupAIPipelineIPC } from "../ai-pipeline-ipc";

function getHandler({ channel }: { channel: string }): IpcHandler {
  const handler = mocks.state.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing IPC handler for channel: ${channel}`);
  }
  return handler;
}

describe("AIPipelineManager fallback behavior", () => {
  beforeEach(() => {
    mocks.state.handlers.clear();
    mocks.state.execBehaviors.clear();
    mocks.state.execCalls = [];
    mocks.state.isPackaged = true;
    mocks.state.decryptedKeys = {
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    };

    mocks.state.binaryStatus = {
      name: "aicp",
      available: false,
      version: "1.0.0",
      path: null,
      checksumValid: false,
      compatible: false,
      updateAvailable: false,
      features: {},
      error: "Binary file not found",
    };

    mocks.mockBinaryManager.reloadManifest.mockClear();
    mocks.mockBinaryManager.getBinaryStatus.mockImplementation(
      () => mocks.state.binaryStatus
    );
    mocks.mockIpcHandle.mockClear();
    mocks.mockSpawn.mockClear();
    mocks.mockGetDecryptedApiKeys.mockClear();
    mocks.mockImportMediaFile.mockClear();
  });

  afterEach(() => {
    cleanupAIPipeline();
    vi.clearAllMocks();
  });

  it("returns packaged reinstall message and skips system/python fallbacks", async () => {
    mocks.state.isPackaged = true;

    setupAIPipelineIPC();

    const status = (await getHandler({ channel: "ai-pipeline:status" })()) as {
      available: boolean;
      source: string;
      error?: string;
    };

    expect(status.available).toBe(false);
    expect(status.source).toBe("unavailable");
    expect(status.error).toContain("bundled binary was not found");
    expect(mocks.state.execCalls).toEqual([]);
  });

  it("uses bundled source when bundled binary is available", async () => {
    mocks.state.isPackaged = true;
    mocks.state.binaryStatus = {
      name: "aicp",
      available: true,
      version: "1.0.1",
      path: "/tmp/aicp",
      checksumValid: true,
      compatible: true,
      updateAvailable: false,
      features: { textToVideo: true },
    };

    setupAIPipelineIPC();

    const status = (await getHandler({ channel: "ai-pipeline:status" })()) as {
      available: boolean;
      source: string;
      version: string | null;
    };

    expect(status.available).toBe(true);
    expect(status.source).toBe("bundled");
    expect(status.version).toBe("1.0.1");
    expect(mocks.state.execCalls).toEqual([]);
  });

  it("falls back to system aicp in development mode", async () => {
    mocks.state.isPackaged = false;
    mocks.state.binaryStatus = {
      name: "aicp",
      available: false,
      version: "1.0.1",
      path: null,
      checksumValid: false,
      compatible: true,
      updateAvailable: false,
      features: {},
      error: "Binary file not found",
    };
    mocks.state.execBehaviors.set("aicp --version", {
      stdout: "1.2.3\n",
    });

    setupAIPipelineIPC();

    const status = (await getHandler({ channel: "ai-pipeline:status" })()) as {
      available: boolean;
      source: string;
      version: string | null;
    };

    expect(status.available).toBe(true);
    expect(status.source).toBe("system");
    expect(status.version).toBe("1.2.3");
    expect(mocks.state.execCalls).toContain("aicp --version");
  });

  it("returns pre-flight missing key error without spawning process", async () => {
    mocks.state.binaryStatus = {
      name: "aicp",
      available: true,
      version: "1.0.1",
      path: "/tmp/aicp",
      checksumValid: true,
      compatible: true,
      updateAvailable: false,
      features: {},
    };
    mocks.state.decryptedKeys = {
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    };

    setupAIPipelineIPC();

    const result = (await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { text: "cat", model: "nano_banana_pro" },
        sessionId: "session-2",
      }
    )) as { success: boolean; errorCode?: string };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("missing_key");
    expect(mocks.mockSpawn).not.toHaveBeenCalled();
  });

  it("does not load API keys during environment detection", async () => {
    mocks.state.binaryStatus = {
      name: "aicp",
      available: true,
      version: "1.0.1",
      path: "/tmp/aicp",
      checksumValid: true,
      compatible: true,
      updateAvailable: false,
      features: {},
    };

    setupAIPipelineIPC();

    await getHandler({ channel: "ai-pipeline:status" })();
    expect(mocks.mockGetDecryptedApiKeys).not.toHaveBeenCalled();
  });
});
