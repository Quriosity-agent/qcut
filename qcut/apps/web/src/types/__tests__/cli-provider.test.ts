/**
 * Tests for CLI Provider Type Definitions and Utilities
 *
 * @module types/__tests__/cli-provider.test
 */

import { describe, it, expect } from "vitest";
import {
  CLI_PROVIDERS,
  DEFAULT_OPENROUTER_MODELS,
  getProviderConfig,
  providerRequiresApiKey,
  getDefaultCodexModel,
  type CliProvider,
  type CliProviderConfig,
  type OpenRouterModel,
} from "../cli-provider";

// ============================================================================
// CLI Provider Configuration Tests
// ============================================================================

describe("CLI_PROVIDERS", () => {
  it("should have all required providers defined", () => {
    expect(CLI_PROVIDERS).toHaveProperty("gemini");
    expect(CLI_PROVIDERS).toHaveProperty("codex");
    expect(CLI_PROVIDERS).toHaveProperty("shell");
  });

  describe("gemini provider", () => {
    const gemini = CLI_PROVIDERS.gemini;

    it("should have correct id and name", () => {
      expect(gemini.id).toBe("gemini");
      expect(gemini.name).toBe("Gemini CLI");
    });

    it("should not require API key (uses OAuth)", () => {
      expect(gemini.requiresApiKey).toBe(false);
    });

    it("should have a valid command", () => {
      expect(gemini.command).toBe("npx @google/gemini-cli@latest");
    });

    it("should not support skill flag (uses prompt injection)", () => {
      expect(gemini.supportsSkillFlag).toBe(false);
    });
  });

  describe("codex provider", () => {
    const codex = CLI_PROVIDERS.codex;

    it("should have correct id and name", () => {
      expect(codex.id).toBe("codex");
      expect(codex.name).toBe("Codex (OpenRouter)");
    });

    it("should require API key", () => {
      expect(codex.requiresApiKey).toBe(true);
      expect(codex.apiKeyEnvVar).toBe("OPENROUTER_API_KEY");
    });

    it("should have a valid command", () => {
      expect(codex.command).toBe("npx open-codex");
    });

    it("should support skill flag", () => {
      expect(codex.supportsSkillFlag).toBe(true);
      expect(codex.skillFlagFormat).toBe("--project-doc");
    });
  });

  describe("shell provider", () => {
    const shell = CLI_PROVIDERS.shell;

    it("should have correct id and name", () => {
      expect(shell.id).toBe("shell");
      expect(shell.name).toBe("Shell");
    });

    it("should not require API key", () => {
      expect(shell.requiresApiKey).toBe(false);
    });

    it("should have empty command (uses default shell)", () => {
      expect(shell.command).toBe("");
    });

    it("should not support skill flag", () => {
      expect(shell.supportsSkillFlag).toBe(false);
    });
  });

  it("should have all required fields in each provider config", () => {
    const requiredFields: (keyof CliProviderConfig)[] = [
      "id",
      "name",
      "description",
      "command",
      "requiresApiKey",
      "supportsSkillFlag",
    ];

    for (const [providerId, config] of Object.entries(CLI_PROVIDERS)) {
      for (const field of requiredFields) {
        expect(config).toHaveProperty(field);
      }
      // Ensure id matches the key
      expect(config.id).toBe(providerId);
    }
  });
});

// ============================================================================
// OpenRouter Models Tests
// ============================================================================

describe("DEFAULT_OPENROUTER_MODELS", () => {
  it("should have at least 6 default models", () => {
    expect(DEFAULT_OPENROUTER_MODELS.length).toBeGreaterThanOrEqual(6);
  });

  it("should have MiniMax M2.1 as first model (default)", () => {
    expect(DEFAULT_OPENROUTER_MODELS[0].id).toBe("minimax/minimax-m2.1");
    expect(DEFAULT_OPENROUTER_MODELS[0].name).toBe("MiniMax M2.1");
  });

  it("should have all required fields in each model", () => {
    const requiredFields: (keyof OpenRouterModel)[] = [
      "id",
      "name",
      "provider",
      "contextLength",
      "pricing",
    ];

    for (const model of DEFAULT_OPENROUTER_MODELS) {
      for (const field of requiredFields) {
        expect(model).toHaveProperty(field);
      }

      // Validate pricing structure
      expect(model.pricing).toHaveProperty("prompt");
      expect(model.pricing).toHaveProperty("completion");
      expect(typeof model.pricing.prompt).toBe("number");
      expect(typeof model.pricing.completion).toBe("number");
    }
  });

  it("should have positive context lengths", () => {
    for (const model of DEFAULT_OPENROUTER_MODELS) {
      expect(model.contextLength).toBeGreaterThan(0);
    }
  });

  it("should have valid model ID format (org/model)", () => {
    for (const model of DEFAULT_OPENROUTER_MODELS) {
      expect(model.id).toMatch(/^[\w-]+\/[\w.-]+$/);
    }
  });

  it("should include models from multiple providers", () => {
    const providers = new Set(DEFAULT_OPENROUTER_MODELS.map((m) => m.provider));
    expect(providers.size).toBeGreaterThan(1);
    expect(providers).toContain("Anthropic");
    expect(providers).toContain("OpenAI");
    expect(providers).toContain("Google");
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("getProviderConfig", () => {
  it("should return correct config for gemini", () => {
    const config = getProviderConfig("gemini");
    expect(config.id).toBe("gemini");
    expect(config.name).toBe("Gemini CLI");
  });

  it("should return correct config for codex", () => {
    const config = getProviderConfig("codex");
    expect(config.id).toBe("codex");
    expect(config.name).toBe("Codex (OpenRouter)");
  });

  it("should return correct config for shell", () => {
    const config = getProviderConfig("shell");
    expect(config.id).toBe("shell");
    expect(config.name).toBe("Shell");
  });

  it("should return same object as CLI_PROVIDERS", () => {
    expect(getProviderConfig("gemini")).toBe(CLI_PROVIDERS.gemini);
    expect(getProviderConfig("codex")).toBe(CLI_PROVIDERS.codex);
    expect(getProviderConfig("shell")).toBe(CLI_PROVIDERS.shell);
  });
});

describe("providerRequiresApiKey", () => {
  it("should return false for gemini", () => {
    expect(providerRequiresApiKey("gemini")).toBe(false);
  });

  it("should return true for codex", () => {
    expect(providerRequiresApiKey("codex")).toBe(true);
  });

  it("should return false for shell", () => {
    expect(providerRequiresApiKey("shell")).toBe(false);
  });
});

describe("getDefaultCodexModel", () => {
  it("should return first model ID", () => {
    const defaultModel = getDefaultCodexModel();
    expect(defaultModel).toBe(DEFAULT_OPENROUTER_MODELS[0].id);
    expect(defaultModel).toBe("minimax/minimax-m2.1");
  });

  it("should return a valid OpenRouter model ID", () => {
    const defaultModel = getDefaultCodexModel();
    expect(defaultModel).toMatch(/^[\w-]+\/[\w.-]+$/);
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety", () => {
  it("should correctly type CliProvider", () => {
    // These should all be valid CliProvider values
    const validProviders: CliProvider[] = ["gemini", "codex", "shell"];

    for (const provider of validProviders) {
      expect(CLI_PROVIDERS[provider]).toBeDefined();
    }
  });

  it("should have matching provider IDs as keys and values", () => {
    const providers: CliProvider[] = ["gemini", "codex", "shell"];

    for (const provider of providers) {
      expect(CLI_PROVIDERS[provider].id).toBe(provider);
    }
  });
});
