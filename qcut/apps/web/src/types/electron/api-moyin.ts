/**
 * Moyin script-to-storyboard sub-interface for ElectronAPI.
 */

export interface ElectronMoyinOps {
	moyin?: {
		parseScript: (options: {
			rawScript: string;
			language?: string;
			sceneCount?: number;
		}) => Promise<{
			success: boolean;
			data?: Record<string, unknown>;
			error?: string;
		}>;
		generateStoryboard: (options: {
			scenes: unknown[];
			styleId?: string;
		}) => Promise<{
			success: boolean;
			outputPaths?: string[];
			error?: string;
		}>;
		callLLM: (options: {
			systemPrompt: string;
			userPrompt: string;
			temperature?: number;
			maxTokens?: number;
		}) => Promise<{
			success: boolean;
			text?: string;
			error?: string;
		}>;
		isClaudeAvailable: () => Promise<boolean>;
		onParsed: (callback: (data: Record<string, unknown>) => void) => void;
		removeParseListener: () => void;
	};
}
