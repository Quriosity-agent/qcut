/**
 * AI Pipeline Manager class — delegates to helper modules.
 * @module electron/ai-pipeline-handler/pipeline-manager
 */

import { spawn, ChildProcess } from "child_process";
import { app } from "electron";
import { getBinaryManager, BinaryManager } from "../binary-manager.js";
import {
	captureOutputSnapshot,
	classifyErrorCode,
	dedupePaths,
	extractOutputPathsFromJson,
	extractOutputPathsFromText,
	recoverOutputPathsFromDirectory,
} from "../ai-pipeline-output.js";
import type {
	PipelineConfig,
	GenerateOptions,
	PipelineProgress,
	PipelineResult,
	PipelineStatus,
} from "./types.js";
import {
	getFallbackConfig,
	detectEnvironment,
} from "./environment.js";
import {
	buildSessionId,
	shouldUseJsonOutput,
	commandSupportsOutputDir,
	commandRequiresFalKey,
	resolveOutputDirectory,
	buildSpawnEnvironment,
	getExecutionTimeoutMs,
	getDefaultFeatures,
} from "./command-builder.js";
import { maybeAutoImportOutput } from "./auto-import.js";

export class AIPipelineManager {
	private config: PipelineConfig;
	private activeProcesses: Map<string, ChildProcess> = new Map();
	private binaryManager: BinaryManager;
	private initialization: Promise<void> | null = null;

	constructor() {
		this.binaryManager = getBinaryManager();
		this.config = getFallbackConfig();
		this.initialization = this.loadEnvironment();
	}

	private async loadEnvironment(): Promise<void> {
		try {
			this.binaryManager.reloadManifest();
		} catch (error) {
			console.error("[AI Pipeline] Failed to reload manifest:", error);
		}

		try {
			this.config = await detectEnvironment(this.binaryManager);
		} catch (error) {
			console.error("[AI Pipeline] Failed to detect environment:", error);
			this.config = getFallbackConfig();
		}
	}

	private async ensureEnvironmentReady(): Promise<void> {
		if (!this.initialization) {
			this.initialization = this.loadEnvironment();
		}

		try {
			await this.initialization;
		} catch (error) {
			console.error("[AI Pipeline] Environment initialization failed:", error);
			this.config = getFallbackConfig();
		}
	}

	async refreshEnvironment(): Promise<void> {
		this.initialization = this.loadEnvironment();
		await this.ensureEnvironmentReady();
	}

	async isAvailable(): Promise<boolean> {
		await this.ensureEnvironmentReady();
		return (
			this.config.binaryPath !== undefined ||
			this.config.pythonPath !== undefined
		);
	}

	async getStatus(): Promise<PipelineStatus> {
		await this.ensureEnvironmentReady();
		const binaryStatus = this.binaryManager.getBinaryStatus("aicp");

		if (this.config.binaryPath && this.config.useBundledBinary) {
			return {
				available: true,
				version: this.config.version || null,
				source: "bundled",
				compatible: binaryStatus.compatible,
				features: binaryStatus.features,
			};
		}

		if (this.config.binaryPath) {
			return {
				available: true,
				version: this.config.version || null,
				source: "system",
				compatible: true,
				features: getDefaultFeatures(),
			};
		}

		if (this.config.pythonPath) {
			return {
				available: true,
				version: this.config.version || null,
				source: "python",
				compatible: true,
				features: getDefaultFeatures(),
			};
		}

		return {
			available: false,
			version: null,
			source: "unavailable",
			compatible: false,
			features: {},
			error: this.getUnavailableErrorMessage(),
		};
	}

	private getUnavailableErrorMessage(): string {
		try {
			if (app.isPackaged) {
				return (
					"AI Content Pipeline is not available. " +
					"The bundled binary was not found or failed validation. " +
					"Please reinstall QCut or contact support."
				);
			}

			return (
				"AI Pipeline binary not found. Install aicp or the " +
				"ai_content_pipeline Python package for development."
			);
		} catch (error) {
			console.warn(
				"[AI Pipeline] Failed to build unavailable message, using fallback:",
				error
			);
			return "AI Pipeline not available";
		}
	}

	getCommand(): { cmd: string; baseArgs: string[] } {
		if (this.config.binaryPath) {
			return { cmd: this.config.binaryPath, baseArgs: [] };
		}
		if (this.config.pythonPath) {
			return {
				cmd: this.config.pythonPath,
				baseArgs: ["-m", "ai_content_pipeline"],
			};
		}
		throw new Error("AI Pipeline not available");
	}

	async execute(
		options: GenerateOptions,
		onProgress: (progress: PipelineProgress) => void
	): Promise<PipelineResult> {
		if (!(await this.isAvailable())) {
			return {
				success: false,
				error: this.getUnavailableErrorMessage(),
				errorCode: "binary_missing",
			};
		}

		const { cmd, baseArgs } = this.getCommand();
		const sessionId = options.sessionId || buildSessionId();
		const args = [...baseArgs, options.command];

		if (
			shouldUseJsonOutput({ command: options.command, args: options.args })
		) {
			args.push("--json");
		}

		for (const [key, value] of Object.entries(options.args)) {
			if (key === "no-json") {
				continue;
			}

			if (value === true) {
				args.push(`--${key}`);
				continue;
			}

			if (value !== false && value !== undefined && value !== "") {
				args.push(`--${key}`, String(value));
			}
		}

		const outputDir = resolveOutputDirectory({ options, sessionId });
		if (outputDir) {
			args.push("--output-dir", outputDir);
		}

		const outputSnapshot = captureOutputSnapshot({ outputDir });
		const spawnEnv = await buildSpawnEnvironment();

		if (
			commandRequiresFalKey({ command: options.command }) &&
			!spawnEnv.FAL_KEY
		) {
			return {
				success: false,
				errorCode: "missing_key",
				error:
					"FAL API key not configured. Go to Editor -> Settings -> API Keys and set FAL API Key.",
			};
		}

		return new Promise((resolve) => {
			console.log("[AI Pipeline] Executing:", cmd, args.join(" "));

			const proc = spawn(cmd, args, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: spawnEnv,
			});

			this.activeProcesses.set(sessionId, proc);

			let stdout = "";
			let stderr = "";
			const startTime = Date.now();
			const timeoutMs = getExecutionTimeoutMs();
			let isSettled = false;
			let timeoutId: NodeJS.Timeout | null = null;

			const resolveOnce = ({ result }: { result: PipelineResult }): void => {
				if (isSettled) {
					return;
				}
				isSettled = true;
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
				try {
					resolve(result);
				} catch (error) {
					console.error("[AI Pipeline] Failed to resolve promise:", error);
				}
			};

			const safeKill = ({ signal }: { signal: NodeJS.Signals }): void => {
				try {
					proc.kill(signal);
				} catch (error) {
					console.warn("[AI Pipeline] Failed to kill process:", error);
				}
			};

			timeoutId = setTimeout(() => {
				try {
					if (this.activeProcesses.has(sessionId)) {
						safeKill({ signal: "SIGTERM" });
						this.activeProcesses.delete(sessionId);
					}
					resolveOnce({
						result: {
							success: false,
							error: `Process timed out after ${Math.round(timeoutMs / 1000)}s`,
							duration: (Date.now() - startTime) / 1000,
						},
					});
				} catch (error) {
					console.error("[AI Pipeline] Timeout handler error:", error);
					resolveOnce({
						result: {
							success: false,
							error: "Process timed out",
							duration: (Date.now() - startTime) / 1000,
						},
					});
				}
			}, timeoutMs);

			proc.stdout?.on("data", (data: Buffer) => {
				const text = data.toString();
				stdout += text;

				const lines = text.split("\n");
				for (const line of lines) {
					if (line.startsWith("PROGRESS:")) {
						try {
							const progress = JSON.parse(line.slice(9)) as PipelineProgress;
							onProgress(progress);
						} catch {
							// Ignore malformed progress lines
						}
					}
				}
			});

			proc.stderr?.on("data", (data: Buffer) => {
				const text = data.toString();
				stderr += text;

				if (text.includes("%") || text.toLowerCase().includes("progress")) {
					const match = text.match(/(\d+)%/);
					if (match) {
						onProgress({
							stage: "processing",
							percent: parseInt(match[1], 10),
							message: text.trim(),
						});
					}
				}
			});

			proc.on("close", async (code: number | null) => {
				this.activeProcesses.delete(sessionId);
				const duration = (Date.now() - startTime) / 1000;

				if (code === 0) {
					try {
						let parsedResult: unknown = null;

						const resultMatch = stdout.match(/RESULT:(.+)$/m);
						if (resultMatch) {
							try {
								parsedResult = JSON.parse(resultMatch[1]);
							} catch (error) {
								console.warn(
									"[AI Pipeline] Failed to parse RESULT payload:",
									error
								);
							}
						}

						const trimmedOutput = stdout.trim();
						if (
							!parsedResult &&
							(trimmedOutput.startsWith("{") || trimmedOutput.startsWith("["))
						) {
							try {
								parsedResult = JSON.parse(trimmedOutput);
							} catch {
								parsedResult = null;
							}
						}

						const outputCandidates: string[] = [];
						if (parsedResult) {
							outputCandidates.push(
								...extractOutputPathsFromJson({
									jsonData: parsedResult,
									outputDir,
								})
							);
						}

						outputCandidates.push(
							...extractOutputPathsFromText({
								text: `${stdout}\n${stderr}`,
								outputDir,
							})
						);
						outputCandidates.push(
							...recoverOutputPathsFromDirectory({
								outputDir,
								outputSnapshot,
							})
						);

						const dedupedOutputPaths = dedupePaths({
							paths: outputCandidates,
						});

						let successResult: PipelineResult = {
							success: true,
							duration,
						};

						if (parsedResult) {
							if (
								typeof parsedResult === "object" &&
								!Array.isArray(parsedResult)
							) {
								const pipelinePayload = parsedResult as Partial<PipelineResult>;
								successResult = {
									...successResult,
									...pipelinePayload,
									success: true,
									duration,
								};
							} else {
								successResult.data = parsedResult;
							}
						}

						if (dedupedOutputPaths.length > 0) {
							successResult.outputPath = dedupedOutputPaths[0];
							successResult.outputPaths = dedupedOutputPaths;
						}

						if (
							commandSupportsOutputDir({ command: options.command }) &&
							!successResult.outputPath
						) {
							resolveOnce({
								result: {
									success: false,
									duration,
									errorCode: "output_unresolved",
									error:
										"Generation finished but the output file could not be located.",
								},
							});
							return;
						}

						const importedResult = await maybeAutoImportOutput({
							options: {
								...options,
								outputDir: outputDir || options.outputDir,
							},
							result: successResult,
						});
						resolveOnce({ result: importedResult });
					} catch (parseError) {
						console.warn("[AI Pipeline] Failed to parse output:", parseError);
						resolveOnce({
							result: {
								success: false,
								duration,
								errorCode: "generation_failed",
								error: "AI generation completed with unreadable output.",
							},
						});
					}
					return;
				}

				const errorMessage =
					stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
				console.error("[AI Pipeline] Failed:", errorMessage);
				resolveOnce({
					result: {
						success: false,
						error: errorMessage,
						errorCode: classifyErrorCode({ errorMessage }),
						duration,
					},
				});
			});

			proc.on("error", (err: Error) => {
				this.activeProcesses.delete(sessionId);
				console.error("[AI Pipeline] Process error:", err);
				resolveOnce({
					result: {
						success: false,
						error: err.message,
						errorCode: classifyErrorCode({ errorMessage: err.message }),
					},
				});
			});
		});
	}

	cancel(sessionId: string): boolean {
		const proc = this.activeProcesses.get(sessionId);
		if (proc) {
			proc.kill("SIGTERM");
			this.activeProcesses.delete(sessionId);
			console.log(`[AI Pipeline] Cancelled session: ${sessionId}`);
			return true;
		}
		return false;
	}

	cancelAll(): void {
		for (const [sessionId, proc] of this.activeProcesses) {
			proc.kill("SIGTERM");
			console.log(`[AI Pipeline] Cancelled session: ${sessionId}`);
		}
		this.activeProcesses.clear();
	}

	getActiveCount(): number {
		return this.activeProcesses.size;
	}
}
