/**
 * Hailuo 2.3 validators.
 */

export function validateHailuo23Duration(duration: number): void {
	if (duration !== 6 && duration !== 10) {
		throw new Error(
			"Duration must be either 6 or 10 seconds for Hailuo 2.3 models"
		);
	}
}

export function validateHailuo23Prompt(prompt: string, modelId: string): void {
	const maxLengths: Record<string, number> = {
		hailuo23_standard_t2v: 1500,
		hailuo23_pro_t2v: 2000,
	};

	const maxLength = maxLengths[modelId];
	if (maxLength && prompt.length > maxLength) {
		throw new Error(
			`Prompt too long for ${modelId}. Maximum ${maxLength} characters allowed (current: ${prompt.length})`
		);
	}
}

export function isHailuo23TextToVideo(modelId: string): boolean {
	return modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v";
}
