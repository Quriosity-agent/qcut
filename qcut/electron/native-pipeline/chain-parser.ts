/**
 * YAML Pipeline Config Parser
 *
 * Parses YAML pipeline definitions into PipelineChain objects
 * and validates data type flow between steps.
 *
 * @module electron/native-pipeline/chain-parser
 */

import yaml from "js-yaml";
import type { ModelCategory } from "./registry.js";
import { ModelRegistry } from "./registry.js";
import type { PipelineChain, PipelineStep } from "./executor.js";
import {
  getInputDataType,
  getOutputDataType,
  type DataType,
} from "./step-executors.js";

interface YamlStep {
  type: string;
  model: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
  retry_count?: number;
}

interface YamlPipeline {
  name: string;
  steps: YamlStep[];
  config?: {
    output_dir?: string;
    save_intermediates?: boolean;
    input_type?: string;
  };
}

export function parseChainConfig(yamlContent: string): PipelineChain {
  const raw = yaml.load(yamlContent) as YamlPipeline;

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML: expected an object");
  }

  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Pipeline must have a 'name' field");
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("Pipeline must have at least one step");
  }

  const steps: PipelineStep[] = raw.steps.map((s, i) => {
    if (!s.type) throw new Error(`Step ${i + 1}: missing 'type'`);
    if (!s.model) throw new Error(`Step ${i + 1}: missing 'model'`);

    return {
      type: s.type as ModelCategory,
      model: s.model,
      params: s.params ?? {},
      enabled: s.enabled !== false,
      retryCount: s.retry_count ?? 0,
    };
  });

  return {
    name: raw.name,
    steps,
    config: {
      outputDir: raw.config?.output_dir,
      saveIntermediates: raw.config?.save_intermediates ?? false,
      inputType: raw.config?.input_type as DataType | undefined,
    },
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateChain(chain: PipelineChain): ValidationResult {
  const errors: string[] = [];
  const enabledSteps = chain.steps.filter((s) => s.enabled);

  if (enabledSteps.length === 0) {
    errors.push("Pipeline has no enabled steps");
    return { valid: false, errors };
  }

  for (let i = 0; i < enabledSteps.length; i++) {
    const step = enabledSteps[i];

    if (!ModelRegistry.has(step.model)) {
      errors.push(`Step ${i + 1}: unknown model '${step.model}'`);
      continue;
    }

    const model = ModelRegistry.get(step.model);
    if (!model.categories.includes(step.type)) {
      errors.push(
        `Step ${i + 1}: model '${step.model}' does not support category '${step.type}' (supports: ${model.categories.join(", ")})`
      );
    }
  }

  for (let i = 1; i < enabledSteps.length; i++) {
    const prev = enabledSteps[i - 1];
    const curr = enabledSteps[i];

    const prevOutputType = getOutputDataType(prev.type);
    const currInputType = getInputDataType(curr.type);

    if (prev.type === "prompt_generation") {
      continue;
    }

    if (!isTypeCompatible(prevOutputType, currInputType)) {
      errors.push(
        `Step ${i + 1}: expects '${currInputType}' input but step ${i} outputs '${prevOutputType}'`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

function isTypeCompatible(outputType: DataType, inputType: DataType): boolean {
  if (outputType === inputType) return true;
  if (inputType === "text") return true;
  return false;
}

export function getDataTypeForCategory(category: ModelCategory): DataType {
  return getOutputDataType(category);
}
