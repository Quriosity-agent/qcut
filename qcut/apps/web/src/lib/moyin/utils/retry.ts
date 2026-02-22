/**
 * Retry utility with exponential backoff
 * Ported from moyin-creator
 */

export interface RetryOptions {
	maxRetries?: number;
	baseDelay?: number;
	onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Check if an error is a rate limit error (429 or quota exceeded)
 */
export function isRateLimitError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const err = error as Record<string, unknown>;

	if (err.status === 429 || err.code === 429) return true;

	const message =
		(typeof err.message === "string" ? err.message : "").toLowerCase() || "";
	if (
		message.includes("429") ||
		message.includes("quota") ||
		message.includes("rate") ||
		message.includes("resource_exhausted") ||
		message.includes("too many requests")
	) {
		return true;
	}

	return false;
}

/**
 * Retry an async operation with exponential backoff for rate limit errors
 */
export async function retryOperation<T>(
	operation: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const { maxRetries = 3, baseDelay = 2000, onRetry } = options;

	if (maxRetries <= 0) {
		throw new Error("maxRetries must be greater than 0");
	}

	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error as Error;

			// Only retry on rate limit errors
			if (!isRateLimitError(error)) {
				throw error;
			}

			if (attempt < maxRetries - 1) {
				const delay = baseDelay * 2 ** attempt;

				if (onRetry) {
					onRetry(attempt + 1, delay, lastError);
				} else {
					console.warn(
						`[Retry] Rate limit hit, retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`
					);
				}

				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError;
}

/**
 * Wrap an async function with retry logic
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
	fn: T,
	options: RetryOptions = {}
): T {
	return ((...args: Parameters<T>) =>
		retryOperation(() => fn(...args), options)) as T;
}
