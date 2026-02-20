/**
 * Base classes for ViMax adapters.
 *
 * Adapters bridge ViMax agents to the underlying generators/services.
 *
 * Ported from: vimax/adapters/base.py
 */

export interface AdapterConfig {
	provider: string;
	model: string;
	timeout: number;
	max_retries: number;
	extra: Record<string, unknown>;
}

export function createAdapterConfig(
	partial?: Partial<AdapterConfig>
): AdapterConfig {
	return {
		provider: "fal",
		model: "",
		timeout: 120.0,
		max_retries: 3,
		extra: {},
		...partial,
	};
}

/**
 * Base class for all ViMax adapters.
 *
 * Adapters translate between ViMax agent interfaces and
 * underlying service APIs (FAL, OpenRouter, etc.)
 */
export abstract class BaseAdapter<T, R> {
	config: AdapterConfig;
	protected _initialized = false;

	constructor(config?: AdapterConfig) {
		this.config = config ?? createAdapterConfig();
	}

	abstract initialize(): Promise<boolean>;
	abstract execute(input: T): Promise<R>;

	async ensureInitialized(): Promise<void> {
		if (!this._initialized) {
			this._initialized = await this.initialize();
			if (!this._initialized) {
				throw new Error(`Failed to initialize ${this.constructor.name}`);
			}
		}
	}

	async call(input: T): Promise<R> {
		await this.ensureInitialized();
		return this.execute(input);
	}
}
