import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

/**
 * E2E tests for secure API key injection into AICP binary.
 *
 * Verifies the full flow:
 *   User key in store → decrypt → inject as env var at spawn → binary reads it
 *
 * And the safety guarantees:
 *   - Keys injected ONLY for auth-required commands
 *   - Keys NOT injected for detection/version/list commands
 *   - Missing key → fast pre-flight error, no spawn
 *   - Multiple provider keys forwarded correctly
 */

type IpcHandler = (...args: unknown[]) => Promise<unknown> | unknown;

interface SpawnCall {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// Mock setup (vi.hoisted runs before imports)
// ---------------------------------------------------------------------------

// Force legacy binary pipeline for these tests (they test spawn/env injection behavior)
const _envSetup = vi.hoisted(() => {
  process.env.QCUT_NATIVE_PIPELINE = "false";
});

vi.mock("../native-pipeline/index.js", () => ({
  NativePipelineManager: class {},
}));

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const spawnCalls: SpawnCall[] = [];

  const state = {
    isPackaged: true,
    handlers,
    spawnCalls,
    binaryStatus: {
      name: "aicp",
      available: true,
      version: "1.0.0",
      path: "/app/resources/bin/aicp",
      checksumValid: true,
      compatible: true,
      updateAvailable: false,
      features: { textToVideo: true, imageToVideo: true },
    },
    decryptedKeys: {
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    },
    /** Controls what the fake spawned process does. */
    spawnBehavior: {
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
  };

  // Simulated spawn that records the env and emits close after a tick.
  const mockSpawn = vi.fn(
    (cmd: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      state.spawnCalls.push({ cmd, args, env: { ...options?.env } });

      const stdoutListeners = new Map<string, (data: Buffer) => void>();
      const stderrListeners = new Map<string, (data: Buffer) => void>();
      const procListeners = new Map<string, (...a: unknown[]) => void>();

      const proc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            stdoutListeners.set(event, cb);
          }),
        },
        stderr: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            stderrListeners.set(event, cb);
          }),
        },
        on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
          procListeners.set(event, cb);
        }),
        kill: vi.fn(),
      } as unknown as ChildProcess;

      // Emit stdout/stderr then close on next tick so the promise resolves.
      setTimeout(() => {
        const behavior = state.spawnBehavior;
        if (behavior.stdout) {
          stdoutListeners.get("data")?.(Buffer.from(behavior.stdout));
        }
        if (behavior.stderr) {
          stderrListeners.get("data")?.(Buffer.from(behavior.stderr));
        }
        procListeners.get("close")?.(behavior.exitCode);
      }, 5);

      return proc;
    }
  );

  const mockGetDecryptedApiKeys = vi.fn(async () => state.decryptedKeys);
  const mockImportMediaFile = vi.fn(async () => null);

  return {
    state,
    mockSpawn,
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

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({
  default: { exec: vi.fn(), spawn: mocks.mockSpawn },
  exec: vi.fn(),
  spawn: mocks.mockSpawn,
}));

vi.mock("node:child_process", () => ({
  default: { exec: vi.fn(), spawn: mocks.mockSpawn },
  exec: vi.fn(),
  spawn: mocks.mockSpawn,
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.3.69",
    getPath: () => "/tmp",
    get isPackaged() {
      return mocks.state.isPackaged;
    },
    on: mocks.mockAppOn,
  },
  ipcMain: { handle: mocks.mockIpcHandle },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
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

// Import after all mocks are wired
import { cleanupAIPipeline, setupAIPipelineIPC } from "../ai-pipeline-ipc";

// Dummy test keys — obviously fake to avoid secret-scanning false positives
const FAKE_FAL_KEY = "test-fal-key-dummy-12345";
const FAKE_GEMINI_KEY = "test-gemini-key-dummy-xyz";
const FAKE_FAL_ONLY_KEY = "test-fal-only-dummy";
const FAKE_FAL_INHERIT_KEY = "test-fal-inherit-dummy";
const FAKE_FAL_SUCCESS_KEY = "test-fal-success-dummy";
const FAKE_FAL_FAIL_KEY = "test-fal-fail-dummy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHandler({ channel }: { channel: string }): IpcHandler {
  const handler = mocks.state.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing IPC handler for channel: ${channel}`);
  }
  return handler;
}

function lastSpawnCall(): SpawnCall {
  const calls = mocks.state.spawnCalls;
  if (calls.length === 0) {
    throw new Error("No spawn calls recorded");
  }
  return calls[calls.length - 1];
}

/** Standard bundled-binary-available state. */
function withBundledBinary(): void {
  mocks.state.binaryStatus = {
    name: "aicp",
    available: true,
    version: "1.0.0",
    path: "/app/resources/bin/aicp",
    checksumValid: true,
    compatible: true,
    updateAvailable: false,
    features: { textToVideo: true, imageToVideo: true },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API key injection e2e", () => {
  beforeEach(() => {
    mocks.state.handlers.clear();
    mocks.state.spawnCalls = [];
    mocks.state.isPackaged = true;
    mocks.state.spawnBehavior = { exitCode: 0, stdout: "", stderr: "" };
    mocks.state.decryptedKeys = {
      falApiKey: "",
      freesoundApiKey: "",
      geminiApiKey: "",
      openRouterApiKey: "",
      anthropicApiKey: "",
    };
    withBundledBinary();

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

  // =========================================================================
  // 1. Key IS injected for generation commands
  // =========================================================================

  describe("injects FAL_KEY into spawn env for auth-required commands", () => {
    const authCommands = [
      "generate-image",
      "create-video",
      "generate-avatar",
      "run-pipeline",
    ] as const;

    for (const command of authCommands) {
      it(`injects FAL_KEY for ${command}`, async () => {
        mocks.state.decryptedKeys.falApiKey = FAKE_FAL_KEY;
        mocks.state.spawnBehavior.stdout = '{"status":"ok"}';

        setupAIPipelineIPC();

        await getHandler({ channel: "ai-pipeline:generate" })(
          {},
          {
            command,
            args: { prompt: "a cat" },
            sessionId: `test-${command}`,
            autoImport: false,
          }
        );

        expect(mocks.mockSpawn).toHaveBeenCalledTimes(1);

        const call = lastSpawnCall();
        expect(call.env.FAL_KEY).toBe(FAKE_FAL_KEY);
        expect(call.env.FAL_API_KEY).toBe(FAKE_FAL_KEY);
      });
    }
  });

  // =========================================================================
  // 2. Key is NOT injected / not required for non-auth commands
  // =========================================================================

  describe("does not require key for non-auth commands", () => {
    it("list-models succeeds without FAL_KEY", async () => {
      mocks.state.decryptedKeys.falApiKey = "";
      mocks.state.spawnBehavior.stdout = '["model-a","model-b"]';

      setupAIPipelineIPC();

      const result = (await getHandler({
        channel: "ai-pipeline:list-models",
      })()) as {
        success: boolean;
      };

      // Should spawn (no pre-flight block) — list-models doesn't require a key
      expect(mocks.mockSpawn).toHaveBeenCalledTimes(1);

      const call = lastSpawnCall();
      expect(call.env.FAL_KEY).toBeUndefined();
    });

    it("estimate-cost succeeds without FAL_KEY", async () => {
      mocks.state.decryptedKeys.falApiKey = "";
      mocks.state.spawnBehavior.stdout = '{"cost":0.05}';

      setupAIPipelineIPC();

      await getHandler({ channel: "ai-pipeline:estimate-cost" })(
        {},
        { model: "kling-pro" }
      );

      expect(mocks.mockSpawn).toHaveBeenCalledTimes(1);
      const call = lastSpawnCall();
      expect(call.env.FAL_KEY).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Pre-flight: missing key → immediate error, no spawn
  // =========================================================================

  describe("pre-flight key validation", () => {
    const authCommands = [
      "generate-image",
      "create-video",
      "generate-avatar",
      "run-pipeline",
    ] as const;

    for (const command of authCommands) {
      it(`blocks ${command} when FAL_KEY is missing`, async () => {
        mocks.state.decryptedKeys.falApiKey = "";

        setupAIPipelineIPC();

        const result = (await getHandler({ channel: "ai-pipeline:generate" })(
          {},
          {
            command,
            args: { prompt: "a cat" },
            sessionId: `missing-key-${command}`,
          }
        )) as { success: boolean; errorCode?: string; error?: string };

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe("missing_key");
        expect(result.error).toContain("API key");
        expect(mocks.mockSpawn).not.toHaveBeenCalled();
      });
    }
  });

  // =========================================================================
  // 4. Multiple provider keys are forwarded
  // =========================================================================

  it("injects both FAL_KEY and GEMINI_API_KEY when both are set", async () => {
    mocks.state.decryptedKeys.falApiKey = FAKE_FAL_KEY;
    mocks.state.decryptedKeys.geminiApiKey = FAKE_GEMINI_KEY;
    mocks.state.spawnBehavior.stdout = '{"status":"ok"}';

    setupAIPipelineIPC();

    await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "landscape" },
        sessionId: "multi-key-test",
        autoImport: false,
      }
    );

    const call = lastSpawnCall();
    expect(call.env.FAL_KEY).toBe(FAKE_FAL_KEY);
    expect(call.env.FAL_API_KEY).toBe(FAKE_FAL_KEY);
    expect(call.env.GEMINI_API_KEY).toBe(FAKE_GEMINI_KEY);
  });

  it("injects FAL_KEY but omits GEMINI_API_KEY when only FAL is set", async () => {
    mocks.state.decryptedKeys.falApiKey = FAKE_FAL_ONLY_KEY;
    mocks.state.decryptedKeys.geminiApiKey = "";
    mocks.state.spawnBehavior.stdout = '{"status":"ok"}';

    setupAIPipelineIPC();

    await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "portrait" },
        sessionId: "fal-only-test",
        autoImport: false,
      }
    );

    const call = lastSpawnCall();
    expect(call.env.FAL_KEY).toBe(FAKE_FAL_ONLY_KEY);
    expect(call.env.GEMINI_API_KEY).toBeUndefined();
  });

  // =========================================================================
  // 5. Key is NOT leaked into version/detection checks
  // =========================================================================

  it("does not call getDecryptedApiKeys during status check", async () => {
    setupAIPipelineIPC();

    await getHandler({ channel: "ai-pipeline:status" })();
    await getHandler({ channel: "ai-pipeline:check" })();

    expect(mocks.mockGetDecryptedApiKeys).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 6. Key decryption failure is handled gracefully
  // =========================================================================

  it("returns missing_key when decryption throws", async () => {
    mocks.mockGetDecryptedApiKeys.mockRejectedValueOnce(
      new Error("Keychain locked")
    );

    setupAIPipelineIPC();

    const result = (await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "cat" },
        sessionId: "decrypt-fail",
      }
    )) as { success: boolean; errorCode?: string };

    // Decryption failure means no key → pre-flight should catch it
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("missing_key");
    expect(mocks.mockSpawn).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 7. Spawn env inherits process.env plus injected keys
  // =========================================================================

  it("spawn env contains process.env values alongside injected keys", async () => {
    mocks.state.decryptedKeys.falApiKey = FAKE_FAL_INHERIT_KEY;
    mocks.state.spawnBehavior.stdout = '{"status":"ok"}';

    setupAIPipelineIPC();

    await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "dog" },
        sessionId: "inherit-test",
        autoImport: false,
      }
    );

    const call = lastSpawnCall();

    // Should have inherited PATH from process.env
    expect(call.env.PATH).toBeDefined();
    // Plus the injected key
    expect(call.env.FAL_KEY).toBe(FAKE_FAL_INHERIT_KEY);
  });

  // =========================================================================
  // 8. Successful generation returns output
  // =========================================================================

  it("returns success with output path when generation completes", async () => {
    mocks.state.decryptedKeys.falApiKey = FAKE_FAL_SUCCESS_KEY;
    mocks.state.spawnBehavior.stdout = JSON.stringify({
      status: "ok",
      outputPath: "/tmp/qcut/aicp-output/result.png",
    });

    setupAIPipelineIPC();

    const result = (await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "sunset" },
        sessionId: "success-test",
        autoImport: false,
      }
    )) as { success: boolean; duration?: number };

    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  // =========================================================================
  // 9. Failed generation returns classified error
  // =========================================================================

  it("returns generation_failed when process exits non-zero", async () => {
    mocks.state.decryptedKeys.falApiKey = FAKE_FAL_FAIL_KEY;
    mocks.state.spawnBehavior.exitCode = 1;
    mocks.state.spawnBehavior.stderr = "Model not found: bad-model";

    setupAIPipelineIPC();

    const result = (await getHandler({ channel: "ai-pipeline:generate" })(
      {},
      {
        command: "generate-image",
        args: { prompt: "fail" },
        sessionId: "fail-test",
        autoImport: false,
      }
    )) as { success: boolean; errorCode?: string; error?: string };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("generation_failed");
    expect(result.error).toContain("Model not found");
  });
});
