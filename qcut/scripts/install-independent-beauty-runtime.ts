import { installIndependentBeautyRuntime } from "../electron/beauty-lab-runtime-install";

async function main() {
	const [sourceRoot, engineRoot, destination, basePython, uv, bun, ...extra] =
		process.argv.slice(2);
	if (
		!sourceRoot ||
		!engineRoot ||
		!destination ||
		!basePython ||
		!uv ||
		!bun ||
		extra.length
	)
		throw new Error(
			"Usage: <installer> <local payload> <engine source> <new install directory> <Python 3.12 executable> <uv executable> <Bun executable>"
		);
	if (process.platform !== "darwin")
		throw new Error("Independent beauty installation requires macOS");
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	try {
		console.log(
			JSON.stringify(
				await installIndependentBeautyRuntime({
					sourceRoot,
					engineRoot,
					destination,
					basePython,
					uv,
					bun,
					signal: controller.signal,
				}),
				null,
				2
			)
		);
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
	}
}
void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
