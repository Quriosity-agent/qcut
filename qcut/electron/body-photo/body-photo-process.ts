import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface BodyPhotoProcess {
	reply: Promise<Record<string, unknown>>;
	closed: Promise<void>;
	stop: () => Promise<void>;
}

export function startBodyPhotoProcess({
	python,
	arguments: args,
	environment,
	replyType,
	timeoutMs = 60_000,
	platform = process.platform,
}: {
	python: string;
	arguments: string[];
	environment: NodeJS.ProcessEnv;
	replyType: "ready" | "verified";
	timeoutMs?: number;
	platform?: NodeJS.Platform;
}): BodyPhotoProcess {
	const child = spawn(python, ["-B", ...args], {
		env: environment,
		detached: platform !== "win32",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const decoder = new StringDecoder("utf8");
	let buffered = "";
	let diagnostics = "";
	let exited = false;
	let stopping: Promise<void> | undefined;
	let rejectReply: (error: Error) => void = () => {};
	const closed = new Promise<void>((resolve) => {
		child.once("close", () => {
			exited = true;
			resolve();
		});
	});
	const signalTree = ({ force }: { force: boolean }) => {
		if (!child.pid) return;
		if (platform === "win32") {
			if (exited) return;
			spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			}).on("error", () => child.kill());
			return;
		}
		try {
			process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
		} catch {
			child.kill(force ? "SIGKILL" : "SIGTERM");
		}
	};
	child.once("exit", () => {
		// A crash can leave descendants holding stdout open after their host exits.
		if (replyType === "ready" && platform !== "win32")
			signalTree({ force: true });
	});
	const stop = () => {
		stopping ??= (async () => {
			rejectReply(new Error("Body-photo operation cancelled"));
			if (exited) return;
			signalTree({ force: false });
			const forceTimer = setTimeout(() => signalTree({ force: true }), 2_000);
			try {
				await closed;
			} finally {
				clearTimeout(forceTimer);
			}
		})();
		return stopping;
	};
	const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
		rejectReply = reject;
		let received: Record<string, unknown> | undefined;
		const timer = setTimeout(() => {
			reject(new Error("Body-photo process startup timed out"));
			void stop();
		}, timeoutMs);
		const finish = () => clearTimeout(timer);
		child.once("error", (error) => {
			finish();
			reject(error);
		});
		child.once("close", (code) => {
			finish();
			if (replyType === "verified" && received && code === 0) {
				resolve(received);
				return;
			}
			reject(
				new Error(
					`Body-photo process exited (${code ?? "signal"})${diagnostics ? `: ${diagnostics}` : ""}`
				)
			);
		});
		child.stdout.on("data", (chunk: Buffer) => {
			buffered += decoder.write(chunk);
			if (buffered.length > 65_536) {
				finish();
				reject(new Error("Body-photo process output exceeded its bound"));
				void stop();
				return;
			}
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				try {
					const value: unknown = JSON.parse(line);
					if (
						value &&
						typeof value === "object" &&
						!Array.isArray(value) &&
						"type" in value &&
						value.type === replyType
					) {
						received = value as Record<string, unknown>;
						if (replyType === "ready") {
							finish();
							resolve(received);
						}
					}
				} catch {
					/* Runtime libraries may write diagnostics before their JSON response. */
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-8192);
		});
	});
	return { reply, closed, stop };
}
