import { describe, expect, it } from "vitest";
import {
  createAdapterConfig,
  BaseAdapter,
} from "../native-pipeline/vimax/adapters/base-adapter.js";

describe("ViMax Adapters", () => {
  describe("AdapterConfig", () => {
    it("createAdapterConfig fills defaults", () => {
      const config = createAdapterConfig();
      expect(config.provider).toBe("fal");
      expect(config.model).toBe("");
      expect(config.timeout).toBe(120.0);
      expect(config.max_retries).toBe(3);
      expect(config.extra).toEqual({});
    });

    it("createAdapterConfig allows overrides", () => {
      const config = createAdapterConfig({
        provider: "fal",
        model: "flux_dev",
        timeout: 120,
      });
      expect(config.provider).toBe("fal");
      expect(config.model).toBe("flux_dev");
      expect(config.timeout).toBe(120);
    });
  });

  describe("BaseAdapter", () => {
    class TestAdapter extends BaseAdapter<string, string> {
      initCalled = false;
      lastInput = "";

      async initialize(): Promise<boolean> {
        this.initCalled = true;
        return true;
      }

      async execute(input: string): Promise<string> {
        this.lastInput = input;
        return `processed: ${input}`;
      }
    }

    it("constructs with default config", () => {
      const adapter = new TestAdapter();
      expect(adapter.config.provider).toBe("fal");
    });

    it("constructs with custom config", () => {
      const adapter = new TestAdapter(createAdapterConfig({ provider: "test" }));
      expect(adapter.config.provider).toBe("test");
    });

    it("ensureInitialized calls initialize once", async () => {
      const adapter = new TestAdapter();
      expect(adapter.initCalled).toBe(false);
      await adapter.ensureInitialized();
      expect(adapter.initCalled).toBe(true);

      adapter.initCalled = false;
      await adapter.ensureInitialized();
      expect(adapter.initCalled).toBe(false);
    });

    it("call() initializes and executes", async () => {
      const adapter = new TestAdapter();
      const result = await adapter.call("hello");
      expect(result).toBe("processed: hello");
      expect(adapter.initCalled).toBe(true);
    });

    it("execute returns transformed input", async () => {
      const adapter = new TestAdapter();
      const result = await adapter.execute("world");
      expect(result).toBe("processed: world");
      expect(adapter.lastInput).toBe("world");
    });
  });
});
