import { spawn } from "node:child_process";

function runCommand({
	command,
	args,
	label,
}: {
	command: string;
	args: Array<string>;
	label: string;
}): Promise<number> {
	return new Promise((resolve, reject) => {
		try {
			const childProcess = spawn(command, args, {
				stdio: "inherit",
				shell: false,
			});

			childProcess.on("error", (error) => {
				reject(
					new Error(
						`${label} failed to start: ${
							error instanceof Error ? error.message : String(error)
						}`
					)
				);
			});

			childProcess.on("exit", (code, signal) => {
				if (signal) {
					process.stderr.write(`${label} terminated by signal ${signal}\n`);
					resolve(1);
					return;
				}

				resolve(code ?? 1);
			});
		} catch (error) {
			reject(error);
		}
	});
}

async function runE2ERecordFlow() {
	try {
		const passthroughArgs = process.argv.slice(2);

		const testExitCode = await runCommand({
			command: "bunx",
			args: ["playwright", "test", ...passthroughArgs],
			label: "Playwright E2E run",
		});

		const collectorExitCode = await runCommand({
			command: "bun",
			args: ["scripts/collect-e2e-videos.ts"],
			label: "E2E video collector",
		});
		const combinerExitCode =
			collectorExitCode === 0
				? await runCommand({
						command: "bun",
						args: ["scripts/combine-e2e-videos.ts"],
						label: "E2E video combiner",
					})
				: 0;

		if (testExitCode !== 0) {
			process.exit(testExitCode);
			return;
		}

		if (collectorExitCode !== 0) {
			process.exit(collectorExitCode);
			return;
		}

		if (combinerExitCode !== 0) {
			process.exit(combinerExitCode);
		}
	} catch (error) {
		process.stderr.write(
			`run-e2e-record failed: ${
				error instanceof Error ? error.message : String(error)
			}\n`
		);
		process.exit(1);
	}
}

runE2ERecordFlow();
