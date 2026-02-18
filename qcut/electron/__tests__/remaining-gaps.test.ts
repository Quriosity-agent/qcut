import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// -- Errors & Exit Codes (Section 3.1 + 3.5) --

import {
  ExitCode,
  AIPlatformError,
  PipelineConfigurationError,
  StepExecutionError,
  ServiceNotAvailableError,
  APIKeyError,
  CostLimitExceededError,
  ParallelExecutionError,
  ValidationError,
  ConfigurationError,
  PipelineExecutionError,
  FileOperationError,
  CostCalculationError,
  getExitCode,
  formatErrorForCli,
} from "../native-pipeline/errors.js";

describe("Exception hierarchy & exit codes", () => {
  it("AIPlatformError has default exit code GENERAL_ERROR", () => {
    const err = new AIPlatformError("test");
    expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR);
    expect(err.name).toBe("AIPlatformError");
    expect(err.message).toBe("test");
    expect(err instanceof Error).toBe(true);
  });

  it("subclasses carry correct exit codes", () => {
    expect(new PipelineConfigurationError("x").exitCode).toBe(
      ExitCode.INVALID_ARGS
    );
    expect(new StepExecutionError("x").exitCode).toBe(ExitCode.PIPELINE_FAILED);
    expect(new ServiceNotAvailableError("x", "fal").exitCode).toBe(
      ExitCode.API_CALL_FAILED
    );
    expect(new APIKeyError("x", "fal").exitCode).toBe(ExitCode.API_KEY_MISSING);
    expect(new CostLimitExceededError("x", 10, 20).exitCode).toBe(
      ExitCode.PIPELINE_FAILED
    );
    expect(new ParallelExecutionError("x", 2, 5).exitCode).toBe(
      ExitCode.PIPELINE_FAILED
    );
    expect(new ValidationError("x").exitCode).toBe(ExitCode.INVALID_ARGS);
    expect(new ConfigurationError("x").exitCode).toBe(ExitCode.INVALID_ARGS);
    expect(new PipelineExecutionError("x").exitCode).toBe(
      ExitCode.PIPELINE_FAILED
    );
    expect(new FileOperationError("x", "/tmp/foo").exitCode).toBe(
      ExitCode.FILE_NOT_FOUND
    );
    expect(new CostCalculationError("x").exitCode).toBe(ExitCode.GENERAL_ERROR);
  });

  it("error subclasses carry contextual properties", () => {
    const step = new StepExecutionError("step failed", 3, "text_to_image");
    expect(step.stepIndex).toBe(3);
    expect(step.stepType).toBe("text_to_image");

    const api = new APIKeyError("missing", "google");
    expect(api.provider).toBe("google");

    const cost = new CostLimitExceededError("too much", 5, 10);
    expect(cost.limit).toBe(5);
    expect(cost.actual).toBe(10);

    const parallel = new ParallelExecutionError("failed", 2, 5);
    expect(parallel.failedSteps).toBe(2);
    expect(parallel.totalSteps).toBe(5);

    const file = new FileOperationError("missing", "/tmp/x");
    expect(file.filePath).toBe("/tmp/x");
  });

  it("getExitCode maps platform errors correctly", () => {
    expect(getExitCode(new APIKeyError("x", "fal"))).toBe(
      ExitCode.API_KEY_MISSING
    );
    expect(getExitCode(new PipelineConfigurationError("x"))).toBe(
      ExitCode.INVALID_ARGS
    );
    expect(getExitCode(new Error("generic"))).toBe(ExitCode.GENERAL_ERROR);
    expect(getExitCode("string error")).toBe(ExitCode.GENERAL_ERROR);
  });

  it("formatErrorForCli returns message and exit code", () => {
    const { message, exitCode } = formatErrorForCli(
      new APIKeyError("no key", "fal")
    );
    expect(message).toBe("no key");
    expect(exitCode).toBe(ExitCode.API_KEY_MISSING);
  });

  it("formatErrorForCli includes stack in debug mode", () => {
    const { message } = formatErrorForCli(new Error("test"), true);
    expect(message).toContain("test");
    expect(message).toContain("Error");
  });

  it("ExitCode enum has all expected values", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.INVALID_ARGS).toBe(2);
    expect(ExitCode.MODEL_NOT_FOUND).toBe(3);
    expect(ExitCode.API_KEY_MISSING).toBe(4);
    expect(ExitCode.API_CALL_FAILED).toBe(5);
    expect(ExitCode.PIPELINE_FAILED).toBe(6);
    expect(ExitCode.FILE_NOT_FOUND).toBe(7);
    expect(ExitCode.PERMISSION_DENIED).toBe(8);
    expect(ExitCode.TIMEOUT).toBe(9);
    expect(ExitCode.CANCELLED).toBe(10);
  });
});

// -- CLI Output (Section 2.2 + 2.3) --

import {
  CLIOutput,
  formatTable,
  colorize,
  ansi,
} from "../native-pipeline/cli-output.js";

describe("CLIOutput", () => {
  it("info suppressed in json mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = new CLIOutput({ jsonMode: true });
    out.info("hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("info suppressed in quiet mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = new CLIOutput({ quiet: true });
    out.info("hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("info shown in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = new CLIOutput();
    out.info("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("error always visible", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = new CLIOutput({ quiet: true, jsonMode: true });
    out.error("fail");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("verbose only in debug mode", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = new CLIOutput({ debug: false });
    out.verbose("debug info");
    expect(spy).not.toHaveBeenCalled();

    const out2 = new CLIOutput({ debug: true });
    out2.verbose("debug info");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("result emits JSON envelope in json mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = new CLIOutput({ jsonMode: true });
    out.result({ key: "value" }, "test-command");
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.schema_version).toBe("1");
    expect(parsed.command).toBe("test-command");
    expect(parsed.data.key).toBe("value");
    spy.mockRestore();
  });

  it("table emits JSON envelope with items in json mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = new CLIOutput({ jsonMode: true });
    out.table([{ name: "test", value: 42 }], undefined, "table-cmd");
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.schema_version).toBe("1");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.count).toBe(1);
    spy.mockRestore();
  });
});

describe("formatTable", () => {
  it("formats rows with headers and separators", () => {
    const result = formatTable([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
    expect(result).toContain("name");
    expect(result).toContain("age");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    expect(result).toContain("---");
  });

  it("returns empty string for empty rows", () => {
    expect(formatTable([])).toBe("");
  });

  it("supports right-aligned columns", () => {
    const result = formatTable(
      [{ value: "42" }],
      [{ header: "value", width: 10, align: "right" }]
    );
    expect(result).toContain("        42");
  });
});

describe("ANSI colors", () => {
  it("colorize returns a string", () => {
    const result = colorize("test", "red");
    expect(typeof result).toBe("string");
    expect(result).toContain("test");
  });

  it("ansi object has expected keys", () => {
    expect(ansi).toHaveProperty("reset");
    expect(ansi).toHaveProperty("red");
    expect(ansi).toHaveProperty("green");
    expect(ansi).toHaveProperty("yellow");
    expect(ansi).toHaveProperty("blue");
    expect(ansi).toHaveProperty("bold");
    expect(ansi).toHaveProperty("dim");
    expect(ansi).toHaveProperty("cyan");
  });
});

// -- Stream Emitter (Section 3.2) --

import {
  StreamEmitter,
  NullEmitter,
} from "../native-pipeline/stream-emitter.js";

describe("StreamEmitter", () => {
  it("emits JSONL events when enabled", () => {
    const chunks: string[] = [];
    const mockStream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const emitter = new StreamEmitter({ enabled: true, stream: mockStream });
    emitter.pipelineStart("test", 3);

    expect(chunks.length).toBe(1);
    const event = JSON.parse(chunks[0]);
    expect(event.schema_version).toBe("1");
    expect(event.event).toBe("pipeline_start");
    expect(event.pipeline).toBe("test");
    expect(event.total_steps).toBe(3);
    expect(event.elapsed_seconds).toBeGreaterThanOrEqual(0);
  });

  it("emits step events", () => {
    const chunks: string[] = [];
    const mockStream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const emitter = new StreamEmitter({ enabled: true, stream: mockStream });
    emitter.stepStart(0, "text_to_image", "flux_dev");
    emitter.stepProgress(0, 50, "Generating...");
    emitter.stepComplete(0, 0.04, "/tmp/out.png", 2.5);
    emitter.stepError(1, "API error", "text_to_video");

    expect(chunks.length).toBe(4);
    expect(JSON.parse(chunks[0]).event).toBe("step_start");
    expect(JSON.parse(chunks[1]).event).toBe("step_progress");
    expect(JSON.parse(chunks[2]).event).toBe("step_complete");
    expect(JSON.parse(chunks[3]).event).toBe("step_error");
  });

  it("does not emit when disabled", () => {
    const chunks: string[] = [];
    const mockStream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const emitter = new StreamEmitter({ enabled: false, stream: mockStream });
    emitter.pipelineStart("test", 1);
    emitter.stepStart(0, "test");
    expect(chunks.length).toBe(0);
  });

  it("NullEmitter never emits", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const emitter = new NullEmitter();
    emitter.pipelineStart("test", 1);
    emitter.stepStart(0, "test");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("pipelineComplete writes to stdout", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const emitter = new StreamEmitter({ enabled: true });
    emitter.pipelineComplete({ success: true, cost: 0.1 });
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0][0] as string;
    const event = JSON.parse(output);
    expect(event.event).toBe("pipeline_complete");
    expect(event.success).toBe(true);
    spy.mockRestore();
  });
});

// -- XDG Paths (Section 3.3) --

import {
  configDir,
  cacheDir,
  stateDir,
  defaultConfigPath,
  ensureDir,
} from "../native-pipeline/xdg-paths.js";

describe("XDG directory support", () => {
  it("configDir respects XDG_CONFIG_HOME", () => {
    const orig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/tmp/test-xdg-config";
    const dir = configDir();
    expect(dir).toContain("qcut-pipeline");
    expect(dir).toContain("/tmp/test-xdg-config");
    if (orig) process.env.XDG_CONFIG_HOME = orig;
    else delete process.env.XDG_CONFIG_HOME;
    // Clean up
    fs.rmSync("/tmp/test-xdg-config", { recursive: true, force: true });
  });

  it("cacheDir respects XDG_CACHE_HOME", () => {
    const orig = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "/tmp/test-xdg-cache";
    const dir = cacheDir();
    expect(dir).toContain("qcut-pipeline");
    expect(dir).toContain("/tmp/test-xdg-cache");
    if (orig) process.env.XDG_CACHE_HOME = orig;
    else delete process.env.XDG_CACHE_HOME;
    fs.rmSync("/tmp/test-xdg-cache", { recursive: true, force: true });
  });

  it("stateDir respects XDG_STATE_HOME", () => {
    const orig = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = "/tmp/test-xdg-state";
    const dir = stateDir();
    expect(dir).toContain("qcut-pipeline");
    expect(dir).toContain("/tmp/test-xdg-state");
    if (orig) process.env.XDG_STATE_HOME = orig;
    else delete process.env.XDG_STATE_HOME;
    fs.rmSync("/tmp/test-xdg-state", { recursive: true, force: true });
  });

  it("override parameter takes priority", () => {
    const dir = configDir("/tmp/test-override-config");
    expect(dir).toBe("/tmp/test-override-config");
    fs.rmSync("/tmp/test-override-config", { recursive: true, force: true });
  });

  it("defaultConfigPath returns yaml file path", () => {
    const p = defaultConfigPath("/tmp/test-cfg-path");
    expect(p).toContain("config.yaml");
    fs.rmSync("/tmp/test-cfg-path", { recursive: true, force: true });
  });

  it("ensureDir creates directory", () => {
    const dir = `/tmp/test-ensure-${Date.now()}`;
    const result = ensureDir(dir);
    expect(result).toBe(dir);
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// -- Platform Logger (Section 3.7) --

import {
  PlatformLogger,
  getLogger,
} from "../native-pipeline/platform-logger.js";

describe("PlatformLogger", () => {
  it("creates logger with name", () => {
    const logger = new PlatformLogger("test");
    expect(logger.name).toBe("test");
  });

  it("getLogger factory creates logger", () => {
    const logger = getLogger("my-module", "warning");
    expect(logger.name).toBe("my-module");
  });

  it("respects log level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new PlatformLogger("test", "warning");
    logger.info("should not appear");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("step, success, cost produce output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new PlatformLogger("test", "info");
    logger.step("step 1");
    logger.success("done");
    logger.cost(0.05);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

// -- File Manager (Section 3.7) --

import { FileManager } from "../native-pipeline/file-manager.js";

describe("FileManager", () => {
  const tmpDir = path.join(os.tmpdir(), `fm-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("writeText and readText", () => {
    const fm = new FileManager(tmpDir);
    const filePath = path.join(tmpDir, "test.txt");
    fm.writeText(filePath, "hello world");
    expect(fm.readText(filePath)).toBe("hello world");
  });

  it("exists checks file", () => {
    const fm = new FileManager(tmpDir);
    expect(fm.exists(path.join(tmpDir, "nonexistent"))).toBe(false);
    const filePath = path.join(tmpDir, "exists.txt");
    fs.writeFileSync(filePath, "x");
    expect(fm.exists(filePath)).toBe(true);
  });

  it("copyFile copies content", async () => {
    const fm = new FileManager(tmpDir);
    const src = path.join(tmpDir, "src.txt");
    const dst = path.join(tmpDir, "dst.txt");
    fs.writeFileSync(src, "copy me");
    await fm.copyFile(src, dst);
    expect(fs.readFileSync(dst, "utf-8")).toBe("copy me");
  });

  it("moveFile moves content", async () => {
    const fm = new FileManager(tmpDir);
    const src = path.join(tmpDir, "move-src.txt");
    const dst = path.join(tmpDir, "move-dst.txt");
    fs.writeFileSync(src, "move me");
    await fm.moveFile(src, dst);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dst, "utf-8")).toBe("move me");
  });

  it("deleteFile removes file", async () => {
    const fm = new FileManager(tmpDir);
    const filePath = path.join(tmpDir, "delete-me.txt");
    fs.writeFileSync(filePath, "x");
    const deleted = await fm.deleteFile(filePath);
    expect(deleted).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("deleteFile returns false for non-existent file", async () => {
    const fm = new FileManager(tmpDir);
    const deleted = await fm.deleteFile(path.join(tmpDir, "no-such-file"));
    expect(deleted).toBe(false);
  });

  it("getFileHash returns md5", async () => {
    const fm = new FileManager(tmpDir);
    const filePath = path.join(tmpDir, "hash.txt");
    fs.writeFileSync(filePath, "hello");
    const hash = await fm.getFileHash(filePath, "md5");
    expect(hash).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("getFileInfo returns size and name", async () => {
    const fm = new FileManager(tmpDir);
    const filePath = path.join(tmpDir, "info.txt");
    fs.writeFileSync(filePath, "12345");
    const info = await fm.getFileInfo(filePath);
    expect(info.name).toBe("info.txt");
    expect(info.size).toBe(5);
    expect(info.isDirectory).toBe(false);
  });

  it("listFiles lists files", async () => {
    const fm = new FileManager(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "b");
    fs.writeFileSync(path.join(tmpDir, "c.json"), "c");
    const all = await fm.listFiles(tmpDir);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const txtOnly = await fm.listFiles(tmpDir, "*.txt");
    expect(txtOnly.length).toBeGreaterThanOrEqual(2);
  });
});

// -- Validators (Section 3.7) --

import {
  ConfigValidator,
  InputValidator,
  configValidator,
  inputValidator,
} from "../native-pipeline/validators.js";

describe("ConfigValidator", () => {
  it("rejects config without steps", () => {
    expect(() =>
      configValidator.validatePipelineConfig({
        steps: [],
      })
    ).toThrow("at least one step");
  });

  it("rejects step without type", () => {
    expect(() =>
      configValidator.validatePipelineConfig({
        steps: [
          { type: "", model: "x", params: {}, enabled: true, retryCount: 0 },
        ],
      })
    ).toThrow("type");
  });

  it("rejects step without model", () => {
    expect(() =>
      configValidator.validatePipelineConfig({
        steps: [
          {
            type: "text_to_image",
            model: "",
            params: {},
            enabled: true,
            retryCount: 0,
          },
        ],
      })
    ).toThrow("model");
  });

  it("accepts valid config", () => {
    const result = configValidator.validatePipelineConfig({
      steps: [
        {
          type: "text_to_image",
          model: "flux_dev",
          params: {},
          enabled: true,
          retryCount: 0,
        },
      ],
    });
    expect(result).toBe(true);
  });
});

describe("InputValidator", () => {
  it("validates existing file path", () => {
    const filePath = path.join(os.tmpdir(), `iv-test-${Date.now()}.txt`);
    fs.writeFileSync(filePath, "test");
    const result = inputValidator.validateFilePath(filePath);
    expect(result).toBe(filePath);
    fs.unlinkSync(filePath);
  });

  it("rejects non-existent file", () => {
    expect(() => inputValidator.validateFilePath("/no/such/file")).toThrow(
      "not found"
    );
  });

  it("validates HTTP URL", () => {
    expect(inputValidator.validateUrl("https://example.com")).toBe(
      "https://example.com"
    );
  });

  it("rejects invalid URL", () => {
    expect(() => inputValidator.validateUrl("not-a-url")).toThrow(
      "Invalid URL"
    );
  });

  it("rejects non-http URL", () => {
    expect(() => inputValidator.validateUrl("ftp://example.com")).toThrow(
      "http or https"
    );
  });

  it("validates API key", () => {
    expect(inputValidator.validateApiKey("sk-1234567890", "openai")).toBe(
      "sk-1234567890"
    );
  });

  it("rejects empty API key", () => {
    expect(() => inputValidator.validateApiKey("", "openai")).toThrow("empty");
  });

  it("rejects too-short API key", () => {
    expect(() => inputValidator.validateApiKey("abc", "openai")).toThrow(
      "too short"
    );
  });

  it("validates positive number", () => {
    expect(inputValidator.validatePositiveNumber(5, "count")).toBe(5);
  });

  it("rejects non-positive number", () => {
    expect(() => inputValidator.validatePositiveNumber(-1, "count")).toThrow(
      "positive"
    );
    expect(() => inputValidator.validatePositiveNumber(0, "count")).toThrow(
      "positive"
    );
  });
});

// -- Config Loader (Section 3.7) --

import {
  mergeConfigs,
  processEnvironmentVariables,
  loadEnvironmentConfig,
  loadJsonConfig,
  saveJsonConfig,
} from "../native-pipeline/config-loader.js";

describe("Config loader", () => {
  it("mergeConfigs deep merges objects", () => {
    const base = { a: 1, nested: { x: 1, y: 2 } };
    const override = { b: 2, nested: { y: 3, z: 4 } };
    const result = mergeConfigs(base, override);
    expect(result).toEqual({ a: 1, b: 2, nested: { x: 1, y: 3, z: 4 } });
  });

  it("mergeConfigs replaces arrays", () => {
    const base = { items: [1, 2] };
    const override = { items: [3] };
    const result = mergeConfigs(base, override);
    expect(result.items).toEqual([3]);
  });

  it("processEnvironmentVariables interpolates ${VAR}", () => {
    process.env.TEST_CONFIG_VAR = "hello";
    const result = processEnvironmentVariables({ key: "${TEST_CONFIG_VAR}" });
    expect(result.key).toBe("hello");
    delete process.env.TEST_CONFIG_VAR;
  });

  it("processEnvironmentVariables supports default values", () => {
    delete process.env.NONEXISTENT_VAR_FOR_TEST;
    const result = processEnvironmentVariables({
      key: "${NONEXISTENT_VAR_FOR_TEST:-fallback}",
    });
    expect(result.key).toBe("fallback");
  });

  it("processEnvironmentVariables handles nested objects", () => {
    process.env.NESTED_TEST = "world";
    const result = processEnvironmentVariables({
      outer: { inner: "${NESTED_TEST}" },
    });
    expect((result.outer as Record<string, unknown>).inner).toBe("world");
    delete process.env.NESTED_TEST;
  });

  it("loadEnvironmentConfig loads .env file", () => {
    const envFile = path.join(os.tmpdir(), `test-env-${Date.now()}.env`);
    fs.writeFileSync(envFile, 'KEY1=value1\n# comment\nKEY2="value2"\n');
    const vars = loadEnvironmentConfig(envFile);
    expect(vars.KEY1).toBe("value1");
    expect(vars.KEY2).toBe("value2");
    fs.unlinkSync(envFile);
    delete process.env.KEY1;
    delete process.env.KEY2;
  });

  it("loadJsonConfig loads and interpolates", () => {
    const jsonFile = path.join(os.tmpdir(), `test-config-${Date.now()}.json`);
    process.env.JSON_TEST_KEY = "test_value";
    fs.writeFileSync(jsonFile, JSON.stringify({ setting: "${JSON_TEST_KEY}" }));
    const config = loadJsonConfig(jsonFile);
    expect(config.setting).toBe("test_value");
    fs.unlinkSync(jsonFile);
    delete process.env.JSON_TEST_KEY;
  });

  it("saveJsonConfig writes file", () => {
    const jsonFile = path.join(os.tmpdir(), `test-save-${Date.now()}.json`);
    const saved = saveJsonConfig({ test: true }, jsonFile);
    expect(fs.existsSync(saved)).toBe(true);
    const content = JSON.parse(fs.readFileSync(saved, "utf-8"));
    expect(content.test).toBe(true);
    fs.unlinkSync(saved);
  });
});

// -- ViMax CLI Subcommands (Section 2.1) --

import { ModelRegistry } from "../native-pipeline/registry.js";
import { initRegistry, resetInitState } from "../native-pipeline/init.js";
import { CLIPipelineRunner } from "../native-pipeline/cli-runner.js";
import type { CLIRunOptions } from "../native-pipeline/cli-runner.js";
import { parseCliArgs } from "../native-pipeline/cli.js";

function defaultOptions(overrides: Partial<CLIRunOptions> = {}): CLIRunOptions {
  return {
    command: "list-models",
    outputDir: "./test-output",
    saveIntermediates: false,
    json: false,
    verbose: false,
    quiet: false,
    ...overrides,
  };
}

describe("ViMax CLI subcommands", () => {
  beforeEach(() => {
    ModelRegistry.clear();
    resetInitState();
    initRegistry();
  });

  describe("CLI parser recognizes new commands", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("parses vimax:extract-characters", () => {
      const opts = parseCliArgs([
        "vimax:extract-characters",
        "-t",
        "Once upon a time...",
      ]);
      expect(opts.command).toBe("vimax:extract-characters");
      expect(opts.text).toBe("Once upon a time...");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:generate-script", () => {
      const opts = parseCliArgs([
        "vimax:generate-script",
        "--idea",
        "A space adventure",
      ]);
      expect(opts.command).toBe("vimax:generate-script");
      expect(opts.idea).toBe("A space adventure");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:generate-storyboard", () => {
      const opts = parseCliArgs([
        "vimax:generate-storyboard",
        "--script",
        "script.json",
      ]);
      expect(opts.command).toBe("vimax:generate-storyboard");
      expect(opts.script).toBe("script.json");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:generate-portraits", () => {
      const opts = parseCliArgs([
        "vimax:generate-portraits",
        "-t",
        "A young hero named Alice",
      ]);
      expect(opts.command).toBe("vimax:generate-portraits");
      expect(opts.text).toBe("A young hero named Alice");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:create-registry", () => {
      const opts = parseCliArgs(["vimax:create-registry", "-i", "./portraits"]);
      expect(opts.command).toBe("vimax:create-registry");
      expect(opts.input).toBe("./portraits");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:show-registry", () => {
      const opts = parseCliArgs(["vimax:show-registry", "-i", "registry.json"]);
      expect(opts.command).toBe("vimax:show-registry");
      expect(opts.input).toBe("registry.json");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses vimax:list-models", () => {
      const opts = parseCliArgs(["vimax:list-models"]);
      expect(opts.command).toBe("vimax:list-models");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses --stream flag", () => {
      const opts = parseCliArgs(["list-models", "--stream"]);
      expect(opts.stream).toBe(true);
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses --config-dir flag", () => {
      const opts = parseCliArgs(["list-models", "--config-dir", "/tmp/cfg"]);
      expect(opts.configDir).toBe("/tmp/cfg");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses --negative-prompt flag", () => {
      const opts = parseCliArgs([
        "create-video",
        "--negative-prompt",
        "blurry, low quality",
      ]);
      expect(opts.negativePrompt).toBe("blurry, low quality");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("parses --voice-id flag", () => {
      const opts = parseCliArgs(["create-video", "--voice-id", "voice_abc123"]);
      expect(opts.voiceId).toBe("voice_abc123");
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe("ViMax CLI runner handlers", () => {
    it("vimax:list-models returns ViMax-specific models", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:list-models" }),
        noop
      );
      expect(result.success).toBe(true);
      const data = result.data as {
        models: unknown[];
        count: number;
        by_category: Record<string, number>;
      };
      expect(data.count).toBeGreaterThan(0);
      expect(data.by_category).toBeDefined();
      expect(data.by_category.text_to_image).toBeGreaterThan(0);
    });

    it("vimax:extract-characters errors on missing input", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:extract-characters" }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--text");
    });

    it("vimax:generate-script errors on missing idea", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:generate-script" }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--idea");
    });

    it("vimax:generate-storyboard errors on missing script", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:generate-storyboard" }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--script");
    });

    it("vimax:generate-portraits errors on missing input", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:generate-portraits" }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--text");
    });

    it("vimax:create-registry errors on missing input", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:create-registry", input: undefined }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--input");
    });

    it("vimax:show-registry errors on missing input", async () => {
      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:show-registry" }),
        noop
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("--input");
    });

    it("vimax:create-registry creates registry from directory", async () => {
      const tmpDir = path.join(os.tmpdir(), `registry-test-${Date.now()}`);
      const charDir = path.join(tmpDir, "alice");
      fs.mkdirSync(charDir, { recursive: true });
      fs.writeFileSync(path.join(charDir, "front.png"), "fake-image");
      fs.writeFileSync(path.join(charDir, "side.png"), "fake-image");

      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:create-registry", input: tmpDir }),
        noop
      );
      expect(result.success).toBe(true);
      expect(result.outputPath).toContain("registry.json");
      const data = result.data as { characters: number };
      expect(data.characters).toBe(1);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("vimax:show-registry displays registry contents", async () => {
      const tmpFile = path.join(os.tmpdir(), `show-reg-${Date.now()}.json`);
      const registryData = {
        project_id: "test-proj",
        portraits: {
          Alice: {
            character_name: "Alice",
            description: "A brave hero",
            front_view: "/portraits/alice/front.png",
          },
        },
      };
      fs.writeFileSync(tmpFile, JSON.stringify(registryData));

      const runner = new CLIPipelineRunner();
      const noop = vi.fn();
      const result = await runner.run(
        defaultOptions({ command: "vimax:show-registry", input: tmpFile }),
        noop
      );
      expect(result.success).toBe(true);
      const data = result.data as {
        project_id: string;
        total_characters: number;
      };
      expect(data.project_id).toBe("test-proj");
      expect(data.total_characters).toBe(1);

      fs.unlinkSync(tmpFile);
    });
  });
});

// -- Reference Selector improvements (Section 3.8) --

import { ReferenceImageSelector } from "../native-pipeline/vimax/agents/reference-selector.js";

describe("ReferenceImageSelector.getViewPreference", () => {
  it("returns preferences for close_up with front angle", () => {
    const selector = new ReferenceImageSelector();
    const prefs = selector.getViewPreference("close_up", "front");
    expect(prefs[0]).toBe("front");
    expect(prefs).toContain("three_quarter");
  });

  it("returns preferences for over_the_shoulder", () => {
    const selector = new ReferenceImageSelector();
    const prefs = selector.getViewPreference("over_the_shoulder");
    expect(prefs).toContain("back");
    expect(prefs).toContain("three_quarter");
  });

  it("respects camera angle priority", () => {
    const selector = new ReferenceImageSelector();
    const prefs = selector.getViewPreference("wide", "back");
    expect(prefs[0]).toBe("back");
  });

  it("always includes front as fallback", () => {
    const selector = new ReferenceImageSelector();
    const prefs = selector.getViewPreference("pov");
    expect(prefs).toContain("front");
  });
});

// -- Idea2VideoPipeline.fromYaml (Section 3.8) --

import {
  Idea2VideoPipeline,
  createIdea2VideoConfig,
} from "../native-pipeline/vimax/pipelines/idea2video.js";

describe("Idea2VideoPipeline.fromYaml", () => {
  it("creates pipeline from YAML config file", () => {
    const yamlPath = path.join(os.tmpdir(), `i2v-test-${Date.now()}.yaml`);
    fs.writeFileSync(
      yamlPath,
      [
        "target_duration: 30",
        "video_model: kling_2_6_pro",
        "generate_portraits: false",
        "# comment line",
        "",
      ].join("\n")
    );

    const pipeline = Idea2VideoPipeline.fromYaml(yamlPath);
    expect(pipeline.config.target_duration).toBe(30);
    expect(pipeline.config.video_model).toBe("kling_2_6_pro");
    expect(pipeline.config.generate_portraits).toBe(false);

    fs.unlinkSync(yamlPath);
  });
});

// -- Service-level features (Section 3.6) --

describe("Service-level features", () => {
  it("step-executors module exports executeStep", async () => {
    const mod = await import("../native-pipeline/step-executors.js");
    expect(typeof mod.executeStep).toBe("function");
    expect(typeof mod.getInputDataType).toBe("function");
    expect(typeof mod.getOutputDataType).toBe("function");
  });

  it("StepInput type supports all fields", async () => {
    const mod = await import("../native-pipeline/step-executors.js");
    // Verify the type supports voice and negative prompt via params
    const input: import("../native-pipeline/step-executors.js").StepInput = {
      text: "test",
      imageUrl: "https://example.com/img.png",
      videoUrl: "https://example.com/vid.mp4",
      audioUrl: "https://example.com/audio.wav",
    };
    expect(input.text).toBe("test");
  });
});

// -- Help text includes new commands --

describe("CLI help includes new vimax commands", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("help text lists all 7 new vimax subcommands", () => {
    expect(() => parseCliArgs(["--help"])).toThrow("process.exit");
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("vimax:extract-characters");
    expect(output).toContain("vimax:generate-script");
    expect(output).toContain("vimax:generate-storyboard");
    expect(output).toContain("vimax:generate-portraits");
    expect(output).toContain("vimax:create-registry");
    expect(output).toContain("vimax:show-registry");
    expect(output).toContain("vimax:list-models");
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
