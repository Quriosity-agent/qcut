/**
 * Runs the E2E smoke set (apps/web/src/test/e2e/smoke-specs.ts) with the
 * invisible window. Extra arguments go to Playwright, for example
 * `bun run test:e2e:smoke -- --reporter=list`. Build the app first.
 */
import { spawn } from "node:child_process";
import { E2E_SMOKE_SPECS } from "../apps/web/src/test/e2e/smoke-specs";

const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const child = spawn(
	"bun",
	["scripts/e2e-virtual-display.ts", ...extraArgs, ...E2E_SMOKE_SPECS],
	{ stdio: "inherit" }
);
child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});
child.on("close", (code) => process.exit(code ?? 1));
