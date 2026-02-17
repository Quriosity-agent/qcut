/**
 * Base classes for ViMax agents.
 *
 * All agents inherit from BaseAgent and implement the process() method.
 * Includes parseLlmJson utility for robust LLM response parsing.
 *
 * Ported from: vimax/agents/base.py
 */

export interface AgentConfig {
  name: string;
  model: string;
  temperature: number;
  max_retries: number;
  timeout: number;
  extra: Record<string, unknown>;
}

export function createAgentConfig(
  partial: Partial<AgentConfig> & { name: string },
): AgentConfig {
  return {
    model: 'gpt-4',
    temperature: 0.7,
    max_retries: 3,
    timeout: 60.0,
    extra: {},
    ...partial,
  };
}

/**
 * Result from an agent execution.
 *
 * Generic over the result type for type-safe agent outputs.
 */
export interface AgentResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  metadata: Record<string, unknown>;
}

export function agentOk<T>(
  result: T,
  metadata?: Record<string, unknown>,
): AgentResult<T> {
  return { success: true, result, metadata: metadata ?? {} };
}

export function agentFail<T>(
  error: string,
  metadata?: Record<string, unknown>,
): AgentResult<T> {
  return { success: false, error, metadata: metadata ?? {} };
}

/**
 * Base class for all ViMax agents.
 *
 * Agents are responsible for specific tasks in the pipeline:
 * - Screenwriter: Generate screenplay from idea
 * - CharacterExtractor: Extract characters from text
 * - StoryboardArtist: Create visual storyboard
 * - etc.
 */
export abstract class BaseAgent<T, R> {
  config: AgentConfig;

  constructor(config?: AgentConfig) {
    this.config = config ?? createAgentConfig({ name: this.constructor.name });
  }

  abstract process(input: T): Promise<AgentResult<R>>;

  validateInput(input: T): boolean {
    return input != null;
  }

  async call(input: T): Promise<AgentResult<R>> {
    if (!this.validateInput(input)) {
      return agentFail('Invalid input data');
    }
    return this.process(input);
  }
}

/**
 * Parse JSON from LLM response text, handling common LLM quirks.
 *
 * Handles: markdown code fences, trailing commas, extra text before/after
 * JSON, unescaped newlines inside strings.
 *
 * @param text - Raw LLM response text
 * @param expect - "object" for {}, "array" for []
 * @returns Parsed JSON data
 * @throws ValueError if no valid JSON can be extracted
 */
export function parseLlmJson(
  text: string,
  expect: 'object' | 'array' = 'object',
): unknown {
  // Step 1: Try parsing raw text directly
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Step 2: Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let textToFix: string;
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      textToFix = fenceMatch[1];
    }
  } else {
    textToFix = text;
  }

  // Step 3: Extract the outermost JSON structure
  const pattern = expect === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = textToFix.match(pattern);

  if (match) {
    const jsonStr = match[0];

    // Try as-is first
    try {
      return JSON.parse(jsonStr);
    } catch {
      // continue
    }

    // Step 4: Fix trailing commas
    const fixed = jsonStr.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(fixed);
    } catch {
      // continue
    }

    // Step 5: Fix unescaped newlines inside strings
    const fixed2 = fixed.replace(
      /(?<=": ")(.*?)(?="[,}\]])/gs,
      (match) => match.replace(/\n/g, '\\n'),
    );
    try {
      return JSON.parse(fixed2);
    } catch {
      // continue
    }

    // Step 6: Try line-by-line repair — remove lines that break JSON
    const lines = fixed.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const attempt = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
      try {
        return JSON.parse(attempt);
      } catch {
        continue;
      }
    }
  }

  throw new Error(`Could not parse JSON ${expect} from LLM response`);
}
