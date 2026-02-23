/**
 * Parallel Pipeline Executor
 *
 * Extends PipelineExecutor to support concurrent step execution.
 * Uses Promise.all/allSettled for I/O-bound API calls (no threads needed).
 *
 * Ported from Python core/parallel_executor.py
 *
 * @module electron/native-pipeline/parallel-executor
 */

import { PipelineExecutor } from "../execution/executor.js";
import type {
	PipelineChain,
	PipelineStep,
	PipelineProgress,
	PipelineResult,
	StepResult,
} from "../execution/executor.js";
import { getInputDataType, getOutputDataType } from "./step-executors.js";

export enum MergeStrategy {
	COLLECT_ALL = "COLLECT_ALL",
	FIRST_SUCCESS = "FIRST_SUCCESS",
	BEST_QUALITY = "BEST_QUALITY",
	MERGE_OUTPUTS = "MERGE_OUTPUTS",
}

export interface ParallelConfig {
	enabled: boolean;
	maxWorkers: number;
}

export interface ParallelStats {
	sequentialTime: number;
	parallelTime: number;
	speedupFactor: number;
	workersUsed: number;
	parallelGroups: number;
}

export interface ParallelGroup {
	type: "explicit" | "implicit";
	steps: PipelineStep[];
	mergeStrategy: MergeStrategy;
}

interface ExecutionPlan {
	groups: Array<{
		parallel: boolean;
		steps: PipelineStep[];
		mergeStrategy: MergeStrategy;
	}>;
}

const PARALLELIZABLE_CATEGORIES = new Set([
	"text_to_image",
	"image_to_image",
	"text_to_speech",
	"avatar",
	"prompt_generation",
	"image_understanding",
]);

const IO_INTENSIVE_CATEGORIES = new Set([
	"text_to_video",
	"image_to_video",
	"video_to_video",
]);

export class ParallelPipelineExecutor extends PipelineExecutor {
	private config: ParallelConfig;
	private stats: ParallelStats = {
		sequentialTime: 0,
		parallelTime: 0,
		speedupFactor: 1,
		workersUsed: 0,
		parallelGroups: 0,
	};

	constructor(config?: Partial<ParallelConfig>) {
		super();
		this.config = {
			enabled: config?.enabled ?? true,
			maxWorkers: config?.maxWorkers ?? 8,
		};
	}

	getStats(): ParallelStats {
		return { ...this.stats };
	}

	async executeChain(
		chain: PipelineChain,
		input: string,
		onProgress: (progress: PipelineProgress) => void,
		signal?: AbortSignal
	): Promise<PipelineResult> {
		if (!this.config.enabled) {
			return super.executeChain(chain, input, onProgress, signal);
		}

		const enabledSteps = chain.steps.filter((s) => s.enabled);
		if (enabledSteps.length === 0) {
			return {
				success: false,
				stepsCompleted: 0,
				totalSteps: 0,
				totalCost: 0,
				totalTime: 0,
				outputs: {},
				error: "No enabled steps",
				stepResults: [],
			};
		}

		const plan = this.analyzeParallelOpportunities(enabledSteps);
		const startTime = Date.now();

		const stepResults: StepResult[] = [];
		let totalCost = 0;
		const outputPaths: string[] = [];
		let lastResult: StepResult | undefined;
		let stepOffset = 0;

		for (const group of plan.groups) {
			if (signal?.aborted) {
				return {
					success: false,
					stepsCompleted: stepResults.length,
					totalSteps: enabledSteps.length,
					totalCost,
					totalTime: (Date.now() - startTime) / 1000,
					outputs: {},
					error: "Pipeline cancelled",
					stepResults,
				};
			}

			if (group.parallel && group.steps.length > 1) {
				this.stats.parallelGroups++;
				onProgress({
					stage: "parallel_group",
					percent: Math.round((stepOffset / enabledSteps.length) * 100),
					message: `Executing ${group.steps.length} steps in parallel`,
					totalSteps: enabledSteps.length,
				});

				const results = await this.executeParallelGroup(
					group.steps,
					input,
					chain.config.outputDir,
					signal,
					(p, m) => {
						onProgress({
							stage: "parallel_step",
							percent: Math.round(
								((stepOffset + (p * group.steps.length) / 100) /
									enabledSteps.length) *
									100
							),
							message: m,
							totalSteps: enabledSteps.length,
						});
					}
				);

				const merged = this.mergeResults(results, group.mergeStrategy);
				for (const r of results) {
					stepResults.push(r);
					if (r.cost) totalCost += r.cost;
					if (r.outputPath) outputPaths.push(r.outputPath);
				}

				if (!merged.success) {
					return {
						success: false,
						stepsCompleted: stepResults.length,
						totalSteps: enabledSteps.length,
						totalCost,
						totalTime: (Date.now() - startTime) / 1000,
						outputs: {},
						error: merged.error || "Parallel group failed",
						stepResults,
					};
				}

				lastResult = merged;
				stepOffset += group.steps.length;
			} else {
				for (const step of group.steps) {
					if (signal?.aborted) {
						return {
							success: false,
							stepsCompleted: stepResults.length,
							totalSteps: enabledSteps.length,
							totalCost,
							totalTime: (Date.now() - startTime) / 1000,
							outputs: {},
							error: "Pipeline cancelled",
							stepResults,
						};
					}

					onProgress({
						stage: `step_${stepOffset + 1}`,
						percent: Math.round((stepOffset / enabledSteps.length) * 100),
						message: `Executing step ${stepOffset + 1}/${enabledSteps.length}: ${step.type} (${step.model})`,
						model: step.model,
						stepIndex: stepOffset,
						totalSteps: enabledSteps.length,
					});

					const stepInput = this.buildInputForStep(step, input, lastResult);
					const result = await this.executeStep(step, stepInput, {
						outputDir: chain.config.outputDir,
						signal,
					});

					stepResults.push(result);
					if (result.cost) totalCost += result.cost;
					if (result.outputPath) outputPaths.push(result.outputPath);

					if (!result.success) {
						return {
							success: false,
							stepsCompleted: stepResults.length,
							totalSteps: enabledSteps.length,
							totalCost,
							totalTime: (Date.now() - startTime) / 1000,
							outputs: {},
							error: `Step ${stepOffset + 1} (${step.model}) failed: ${result.error}`,
							stepResults,
						};
					}

					lastResult = result;
					stepOffset++;
				}
			}
		}

		const totalTime = (Date.now() - startTime) / 1000;
		this.stats.parallelTime = totalTime;
		this.stats.sequentialTime = stepResults.reduce(
			(sum, r) => sum + r.duration,
			0
		);
		this.stats.speedupFactor =
			this.stats.sequentialTime > 0
				? this.stats.sequentialTime / this.stats.parallelTime
				: 1;

		onProgress({
			stage: "complete",
			percent: 100,
			message: `Pipeline completed (speedup: ${this.stats.speedupFactor.toFixed(1)}x)`,
			totalSteps: enabledSteps.length,
		});

		return {
			success: true,
			stepsCompleted: enabledSteps.length,
			totalSteps: enabledSteps.length,
			totalCost,
			totalTime,
			outputs: { finalOutput: lastResult?.data, parallelStats: this.stats },
			stepResults,
			outputPath: lastResult?.outputPath || outputPaths[outputPaths.length - 1],
			outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
		};
	}

	analyzeParallelOpportunities(steps: PipelineStep[]): ExecutionPlan {
		const groups: ExecutionPlan["groups"] = [];
		let currentParallelBatch: PipelineStep[] = [];

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];

			if (this.canParallelizeStep(step, i, steps)) {
				currentParallelBatch.push(step);
			} else {
				if (currentParallelBatch.length > 0) {
					groups.push({
						parallel: currentParallelBatch.length > 1,
						steps: [...currentParallelBatch],
						mergeStrategy: MergeStrategy.COLLECT_ALL,
					});
					currentParallelBatch = [];
				}
				groups.push({
					parallel: false,
					steps: [step],
					mergeStrategy: MergeStrategy.COLLECT_ALL,
				});
			}
		}

		if (currentParallelBatch.length > 0) {
			groups.push({
				parallel: currentParallelBatch.length > 1,
				steps: [...currentParallelBatch],
				mergeStrategy: MergeStrategy.COLLECT_ALL,
			});
		}

		return { groups };
	}

	canParallelizeStep(
		step: PipelineStep,
		index: number,
		allSteps: PipelineStep[]
	): boolean {
		if (
			!PARALLELIZABLE_CATEGORIES.has(step.type) &&
			!IO_INTENSIVE_CATEGORIES.has(step.type)
		) {
			return false;
		}

		if (index === 0) return true;

		const prevStep = allSteps[index - 1];
		const prevOutputType = getOutputDataType(prevStep.type);
		const currInputType = getInputDataType(step.type);

		if (prevOutputType === currInputType) {
			return false;
		}

		const hasTemplateRef = Object.values(step.params).some(
			(v) => typeof v === "string" && v.includes("{{")
		);
		if (hasTemplateRef) {
			return false;
		}

		return true;
	}

	private async executeParallelGroup(
		steps: PipelineStep[],
		input: string,
		outputDir?: string,
		signal?: AbortSignal,
		onProgress?: (percent: number, message: string) => void
	): Promise<StepResult[]> {
		const maxConcurrent = Math.min(steps.length, this.config.maxWorkers);
		this.stats.workersUsed = Math.max(this.stats.workersUsed, maxConcurrent);

		const promises = steps.map(async (step, i) => {
			const stepInput = this.buildInputForStep(step, input);
			onProgress?.(
				Math.round((i / steps.length) * 100),
				`Starting parallel step: ${step.model}`
			);
			return this.executeStep(step, stepInput, { outputDir, signal });
		});

		const settled = await Promise.allSettled(promises);

		return settled.map((r, i) => {
			if (r.status === "fulfilled") return r.value;
			return {
				success: false,
				error: `Parallel step ${steps[i].model} failed: ${r.reason}`,
				duration: 0,
			};
		});
	}

	private mergeResults(
		results: StepResult[],
		strategy: MergeStrategy
	): StepResult {
		switch (strategy) {
			case MergeStrategy.FIRST_SUCCESS: {
				const first = results.find((r) => r.success);
				return first || results[0];
			}
			case MergeStrategy.BEST_QUALITY: {
				const successful = results.filter((r) => r.success);
				if (successful.length === 0) return results[0];
				return successful[0];
			}
			case MergeStrategy.MERGE_OUTPUTS: {
				const successful = results.filter((r) => r.success);
				if (successful.length === 0) return results[0];
				return {
					success: true,
					outputPath: successful[successful.length - 1].outputPath,
					duration: Math.max(...successful.map((r) => r.duration)),
					cost: successful.reduce((sum, r) => sum + (r.cost || 0), 0),
					data: successful.map((r) => r.data),
				};
			}
			default: {
				const allSuccess = results.every((r) => r.success);
				const failed = results.filter((r) => !r.success);
				return {
					success: allSuccess,
					outputPath: results.find((r) => r.outputPath)?.outputPath,
					duration: Math.max(...results.map((r) => r.duration)),
					cost: results.reduce((sum, r) => sum + (r.cost || 0), 0),
					data: results.map((r) => r.data),
					error: allSuccess ? undefined : failed.map((r) => r.error).join("; "),
				};
			}
		}
	}

	private buildInputForStep(
		step: PipelineStep,
		rawInput: string,
		previousResult?: StepResult
	): {
		text?: string;
		imageUrl?: string;
		videoUrl?: string;
		audioUrl?: string;
	} {
		const input: {
			text?: string;
			imageUrl?: string;
			videoUrl?: string;
			audioUrl?: string;
		} = {};

		const inputType = getInputDataType(step.type);
		switch (inputType) {
			case "text":
				input.text = previousResult?.text || rawInput;
				break;
			case "image":
				input.imageUrl =
					previousResult?.outputUrl || previousResult?.outputPath || rawInput;
				break;
			case "video":
				input.videoUrl =
					previousResult?.outputUrl || previousResult?.outputPath || rawInput;
				break;
			case "audio":
				input.audioUrl =
					previousResult?.outputUrl || previousResult?.outputPath || rawInput;
				break;
		}

		return input;
	}
}
