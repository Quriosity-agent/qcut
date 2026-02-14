import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type IpcHandler = (...args: unknown[]) => Promise<unknown> | unknown;

type SpawnCall = {
  cmd: string;
  args: string[];
  options: {
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
    stdio?: unknown;
  };
  proc: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
};

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();

  const state = {
    handlers,
    isPackaged: true,
    spawnCalls: [] as SpawnCall[],
    binaryStatus: {
      name: "aicp",
      available: true,
      version: "1.0.25",
      path: "/tmp/aicp",
      checksumValid: true,
      compatible: true,
      updateAvailable: false,
      features: {},
    },
  };

  const mockSpawn = vi.fn((cmd: string, args: string[], options: SpawnCall["options"]) => {
    const proc = new EventEmitter() as SpawnCall["proc"];
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    state.spawnCalls.push({
      cmd,
      args,
      options,
      proc,
    });

    return proc;
  });

  const mockExec = vi.fn();
  const mockGetDecryptedApiKeys = vi.fn(async () => ({
    falApiKey: "",
    freesoundApiKey: "",
    geminiApiKey: "",
    openRouterApiKey: "",
    anthropicApiKey: "",
  }));
  const mockImportMediaFile = vi.fn(async () => null);

  return {
    state,
    mockSpawn,
    mockExec,
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
  spawn: mocks.mockSpawn,
  exec: mocks.mockExec,
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.3.67",
    getPath: (name: string) => {
      if (name === "temp") {
        return os.tmpdir();
      }
      return os.homedir();
    },
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

import { cleanupAIPipeline, setupAIPipelineIPC } from "../ai-pipeline-handler";

function getHandler({ channel }: { channel: string }): IpcHandler {
  const handler = mocks.state.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing IPC handler for channel: ${channel}`);
  }
  return handler;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AI pipeline secure API key injection and output recovery", () => {
  beforeEach(() => {
    mocks.state.handlers.clear();
    mocks.state.spawnCalls = [];
    mocks.mockIpcHandle.mockClear();
    mocks.mockSpawn.mockClear();
    mocks.mockGetDecryptedApiKeys.mockClear();
    mocks.mockImportMediaFile.mockClear();
    mocks.mockBinaryManager.reloadManifest.mockClear();
    mocks.mockBinaryManager.getBinaryStatus.mockImplementation(
      () => mocks.state.binaryStatus
    );
  });

  afterEach(() => {
    cleanupAIPipeline();
    vi.clearAllMocks();
  });

  it("injects decrypted API keys into spawn env without logging key values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    mocks.mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "fal-secret-key",
      freesoundApiKey: "",
      geminiApiKey: "gemini-secret-key",
      openRouterApiKey: "",
      anthropicApiKey: "",
    });

    setupAIPipelineIPC();

    const resultPromise = getHandler({ channel: "ai-pipeline:generate" })(
      {},
      { command: "list-models", args: {}, sessionId: "session-1" }
    ) as Promise<{ success: boolean }>;

    await flushPromises();
    const spawnCall = mocks.state.spawnCalls[0];
    expect(spawnCall).toBeDefined();
    expect(spawnCall.options.env?.FAL_KEY).toBe("fal-secret-key");
    expect(spawnCall.options.env?.FAL_API_KEY).toBe("fal-secret-key");
    expect(spawnCall.options.env?.GEMINI_API_KEY).toBe("gemini-secret-key");
    expect(spawnCall.args).not.toContain("--json");

    spawnCall.proc.stdout.emit("data", Buffer.from("[]"));
    spawnCall.proc.emit("close", 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);

    const allLogs = logSpy.mock.calls.flat().join(" ");
    expect(allLogs).not.toContain("fal-secret-key");
    expect(allLogs).not.toContain("gemini-secret-key");

    logSpy.mockRestore();
  });

  it("returns a fast missing-key error for generation commands", async () => {
    mocks.mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    });

    setupAIPipelineIPC();

    const result = (await getHandler({ channel: "ai-pipeline:generate" })({}, {
      command: "generate-image",
      args: { text: "cat", model: "nano_banana_pro" },
      sessionId: "session-2",
    })) as {
      success: boolean;
      errorCode?: string;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("missing_key");
    expect(result.error).toContain("Editor -> Settings -> API Keys");
    expect(mocks.state.spawnCalls).toHaveLength(0);
  });

  it("recovers output path from output directory diff when CLI output is missing", async () => {
    mocks.mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "fal-secret-key",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-aicp-test-"));

    try {
      setupAIPipelineIPC();

      const resultPromise = getHandler({ channel: "ai-pipeline:generate" })(
        {},
        {
          command: "generate-image",
          args: { text: "cat", model: "nano_banana_pro" },
          outputDir,
          sessionId: "session-3",
          autoImport: false,
        }
      ) as Promise<{ success: boolean; outputPath?: string }>;

      await flushPromises();
      const spawnCall = mocks.state.spawnCalls[0];
      const generatedFile = path.join(outputDir, "generated_image.png");
      fs.writeFileSync(generatedFile, "image-bytes", "utf8");

      spawnCall.proc.stdout.emit("data", Buffer.from("Generation complete\n"));
      spawnCall.proc.emit("close", 0);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(generatedFile);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("auto-imports generated output when projectId is provided", async () => {
    mocks.mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "fal-secret-key",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    });
    mocks.mockImportMediaFile.mockResolvedValue({
      id: "media_test-id",
      path: "/tmp/projects/project-1/media/imported/generated.png",
    });

    setupAIPipelineIPC();

    const resultPromise = getHandler({ channel: "ai-pipeline:generate" })({}, {
      command: "generate-image",
      args: { text: "cat", model: "nano_banana_pro" },
      sessionId: "session-4",
      projectId: "project-1",
    }) as Promise<{
      success: boolean;
      mediaId?: string;
      importedPath?: string;
    }>;

    await flushPromises();
    const spawnCall = mocks.state.spawnCalls[0];
    spawnCall.proc.stdout.emit(
      "data",
      Buffer.from('RESULT:{"outputPath":"/tmp/generated.png"}\n')
    );
    spawnCall.proc.emit("close", 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.mediaId).toBe("media_test-id");
    expect(result.importedPath).toBe(
      "/tmp/projects/project-1/media/imported/generated.png"
    );
    expect(mocks.mockImportMediaFile).toHaveBeenCalledWith(
      "project-1",
      "/tmp/generated.png"
    );
  });

  it("does not load API keys during environment detection", async () => {
    setupAIPipelineIPC();

    const status = (await getHandler({ channel: "ai-pipeline:status" })()) as {
      available: boolean;
    };

    expect(status.available).toBe(true);
    expect(mocks.mockGetDecryptedApiKeys).not.toHaveBeenCalled();
  });
});
