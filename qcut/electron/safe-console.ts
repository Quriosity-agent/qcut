/**
 * EPIPE-safe console patching.
 *
 * When Electron's stdout/stderr pipe is broken (e.g., during shutdown or when
 * spawned by a parent that closes its end), console methods throw EPIPE
 * synchronously. This module wraps all console methods to swallow EPIPE errors
 * and installs stream-level error handlers as a belt-and-suspenders measure.
 *
 * Call once at process startup in both main and utility processes.
 */

export function installEpipeGuard(): void {
	for (const stream of [process.stdout, process.stderr]) {
		stream?.on?.("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EPIPE") return;
		});
	}
	for (const method of ["log", "warn", "error", "info", "debug"] as const) {
		const original = console[method];
		if (typeof original === "function") {
			(console as unknown as Record<string, unknown>)[method] = (
				...args: unknown[]
			) => {
				try {
					original.apply(console, args);
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException)?.code !== "EPIPE") throw err;
				}
			};
		}
	}
}
