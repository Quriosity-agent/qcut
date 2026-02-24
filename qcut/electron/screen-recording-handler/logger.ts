interface Logger {
	error(message?: unknown, ...optionalParams: unknown[]): void;
	warn(message?: unknown, ...optionalParams: unknown[]): void;
}

const noop = (): void => {};
let log: Logger = { error: noop, warn: noop };
import("electron-log/main")
	.then((module) => {
		log = module.default as Logger;
	})
	.catch(() => {
		// keep noop logger when electron-log isn't available
	});

export { log };
export type { Logger };
