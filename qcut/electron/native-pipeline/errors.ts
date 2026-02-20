/**
 * Exception hierarchy and structured exit codes
 *
 * Provides typed error classes for programmatic error handling
 * and exit code mapping for CLI usage.
 *
 * Ported from: core/exceptions.py + cli/exit_codes.py
 *
 * @module electron/native-pipeline/errors
 */

// -- Exit Codes --

export enum ExitCode {
	SUCCESS = 0,
	GENERAL_ERROR = 1,
	INVALID_ARGS = 2,
	MODEL_NOT_FOUND = 3,
	API_KEY_MISSING = 4,
	API_CALL_FAILED = 5,
	PIPELINE_FAILED = 6,
	FILE_NOT_FOUND = 7,
	PERMISSION_DENIED = 8,
	TIMEOUT = 9,
	CANCELLED = 10,
}

// -- Exception Hierarchy --

export class AIPlatformError extends Error {
	readonly exitCode: ExitCode;

	constructor(message: string, exitCode: ExitCode = ExitCode.GENERAL_ERROR) {
		super(message);
		this.name = "AIPlatformError";
		this.exitCode = exitCode;
	}
}

export class PipelineConfigurationError extends AIPlatformError {
	constructor(message: string) {
		super(message, ExitCode.INVALID_ARGS);
		this.name = "PipelineConfigurationError";
	}
}

export class StepExecutionError extends AIPlatformError {
	readonly stepIndex?: number;
	readonly stepType?: string;

	constructor(message: string, stepIndex?: number, stepType?: string) {
		super(message, ExitCode.PIPELINE_FAILED);
		this.name = "StepExecutionError";
		this.stepIndex = stepIndex;
		this.stepType = stepType;
	}
}

export class ServiceNotAvailableError extends AIPlatformError {
	readonly service: string;

	constructor(message: string, service: string) {
		super(message, ExitCode.API_CALL_FAILED);
		this.name = "ServiceNotAvailableError";
		this.service = service;
	}
}

export class APIKeyError extends AIPlatformError {
	readonly provider: string;

	constructor(message: string, provider: string) {
		super(message, ExitCode.API_KEY_MISSING);
		this.name = "APIKeyError";
		this.provider = provider;
	}
}

export class CostLimitExceededError extends AIPlatformError {
	readonly limit: number;
	readonly actual: number;

	constructor(message: string, limit: number, actual: number) {
		super(message, ExitCode.PIPELINE_FAILED);
		this.name = "CostLimitExceededError";
		this.limit = limit;
		this.actual = actual;
	}
}

export class ParallelExecutionError extends AIPlatformError {
	readonly failedSteps: number;
	readonly totalSteps: number;

	constructor(message: string, failedSteps: number, totalSteps: number) {
		super(message, ExitCode.PIPELINE_FAILED);
		this.name = "ParallelExecutionError";
		this.failedSteps = failedSteps;
		this.totalSteps = totalSteps;
	}
}

export class ValidationError extends AIPlatformError {
	constructor(message: string) {
		super(message, ExitCode.INVALID_ARGS);
		this.name = "ValidationError";
	}
}

export class ConfigurationError extends AIPlatformError {
	constructor(message: string) {
		super(message, ExitCode.INVALID_ARGS);
		this.name = "ConfigurationError";
	}
}

export class PipelineExecutionError extends AIPlatformError {
	constructor(message: string) {
		super(message, ExitCode.PIPELINE_FAILED);
		this.name = "PipelineExecutionError";
	}
}

export class FileOperationError extends AIPlatformError {
	readonly filePath: string;

	constructor(message: string, filePath: string) {
		super(message, ExitCode.FILE_NOT_FOUND);
		this.name = "FileOperationError";
		this.filePath = filePath;
	}
}

export class CostCalculationError extends AIPlatformError {
	constructor(message: string) {
		super(message, ExitCode.GENERAL_ERROR);
		this.name = "CostCalculationError";
	}
}

/**
 * Get the exit code for an error.
 * AIPlatformError subclasses carry their own exit code.
 * Generic errors map to GENERAL_ERROR.
 */
export function getExitCode(error: unknown): ExitCode {
	if (error instanceof AIPlatformError) {
		return error.exitCode;
	}
	return ExitCode.GENERAL_ERROR;
}

/**
 * Print error to stderr and return the appropriate exit code.
 * Does not call process.exit — caller decides.
 */
export function formatErrorForCli(
	error: unknown,
	debug = false
): {
	message: string;
	exitCode: ExitCode;
} {
	const exitCode = getExitCode(error);
	let message: string;

	if (error instanceof Error) {
		message = error.message;
		if (debug && error.stack) {
			message += `\n${error.stack}`;
		}
	} else {
		message = String(error);
	}

	return { message, exitCode };
}
