/**
 * CLI Provider Types for QCut Multi-Provider CLI Support
 *
 * Supports multiple AI coding agents:
 * - Gemini CLI: Free with Google account, uses OAuth
 * - Codex (OpenRouter): 300+ models, pay-per-use with API key
 * - Claude Code: Direct Anthropic access, requires claude CLI installed
 */

/**
 * Supported CLI providers for AI coding agents.
 */
export type CliProvider = "gemini" | "codex" | "claude" | "shell";

/**
 * Configuration for each CLI provider.
 */
export interface CliProviderConfig {
  /** Provider identifier */
  id: CliProvider;
  /** Human-readable provider name */
  name: string;
  /** Description of the provider */
  description: string;
  /** Command to spawn the CLI */
  command: string;
  /** Whether the provider requires an API key */
  requiresApiKey: boolean;
  /** Environment variable name for API key (if applicable) */
  apiKeyEnvVar?: string;
  /** Whether the provider supports skill injection via command flag */
  supportsSkillFlag: boolean;
  /** Format for skill flag (e.g., "--system-prompt" or "--full-context") */
  skillFlagFormat?: string;
}

/**
 * Provider configurations.
 */
export const CLI_PROVIDERS: Record<CliProvider, CliProviderConfig> = {
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's Gemini AI assistant",
    command: "npx @google/gemini-cli@latest",
    requiresApiKey: false, // Uses OAuth
    supportsSkillFlag: false, // Uses prompt injection
  },
  codex: {
    id: "codex",
    name: "Codex (OpenRouter)",
    description: "Multi-model AI via OpenRouter (300+ models)",
    command: "npx open-codex",
    requiresApiKey: true,
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    supportsSkillFlag: true,
    skillFlagFormat: "--project-doc", // Pass skill markdown file as context
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's Claude AI assistant (requires claude CLI)",
    command: "claude",
    requiresApiKey: true,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    supportsSkillFlag: true,
    skillFlagFormat: "--append-system-prompt", // Append skill content to system prompt
  },
  shell: {
    id: "shell",
    name: "Shell",
    description: "Standard terminal shell",
    command: "", // Uses default shell
    requiresApiKey: false,
    supportsSkillFlag: false,
  },
};

/**
 * Available models for Codex/OpenRouter.
 */
export interface OpenRouterModel {
  /** Model ID in OpenRouter format (e.g., "anthropic/claude-sonnet-4") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Model provider (e.g., "Anthropic", "OpenAI") */
  provider: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Pricing per 1K tokens (USD) */
  pricing: {
    prompt: number;
    completion: number;
  };
}

/**
 * Default models to show in selector.
 * These are popular, high-quality models with good code generation capabilities.
 */
export const DEFAULT_OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: "minimax/minimax-m2.1",
    name: "MiniMax M2.1",
    provider: "MiniMax",
    contextLength: 1000000,
    pricing: { prompt: 0.0006, completion: 0.0022 },
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    contextLength: 200000,
    pricing: { prompt: 0.003, completion: 0.015 },
  },
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    provider: "Anthropic",
    contextLength: 200000,
    pricing: { prompt: 0.015, completion: 0.075 },
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextLength: 128000,
    pricing: { prompt: 0.005, completion: 0.015 },
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    contextLength: 1000000,
    pricing: { prompt: 0.00125, completion: 0.005 },
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    provider: "DeepSeek",
    contextLength: 64000,
    pricing: { prompt: 0.00014, completion: 0.00028 },
  },
];

/**
 * Available models for Claude Code CLI.
 */
export interface ClaudeModel {
  /** Model alias (e.g., "sonnet", "opus", "haiku") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Description of the model's strengths */
  description: string;
  /** Maximum context length in tokens */
  contextLength: number;
}

/**
 * Default models for Claude Code CLI.
 * These use Anthropic's simple aliases rather than full model names.
 */
export const CLAUDE_MODELS: ClaudeModel[] = [
  {
    id: "sonnet",
    name: "Claude Sonnet 4",
    description: "Balanced quality and speed",
    contextLength: 200000,
  },
  {
    id: "opus",
    name: "Claude Opus 4.5",
    description: "Maximum quality",
    contextLength: 200000,
  },
  {
    id: "haiku",
    name: "Claude Haiku 4",
    description: "Fast and efficient",
    contextLength: 200000,
  },
];

/**
 * Get provider configuration by ID.
 */
export function getProviderConfig(provider: CliProvider): CliProviderConfig {
  return CLI_PROVIDERS[provider];
}

/**
 * Check if a provider requires API key configuration.
 */
export function providerRequiresApiKey(provider: CliProvider): boolean {
  return CLI_PROVIDERS[provider].requiresApiKey;
}

/**
 * Get default model for Codex provider.
 */
export function getDefaultCodexModel(): string {
  return DEFAULT_OPENROUTER_MODELS[0].id;
}

/**
 * Get default model for Claude provider.
 */
export function getDefaultClaudeModel(): string {
  return CLAUDE_MODELS[0].id;
}
