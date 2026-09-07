/**
 * Editor API token — real Electron evidence.
 *
 * Launched without QCUT_API_TOKEN, the app mints a per-launch bearer token,
 * publishes it in `<XDG_STATE_HOME>/qcut-pipeline/instances/<port>.json`
 * (owner-only), and rejects unauthenticated or wrongly authenticated pointer
 * requests. The CLI, given only the port, discovers the token from that file,
 * and `instances list` probes the editor with it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { createTestProject } from "./helpers/electron-helpers";
import { isolatedElectronTest } from "./helpers/isolated-electron-fixture";
import { runQCutPipelineCli } from "./helpers/qcut-pipeline-cli";

interface PublishedInstance {
	host?: string;
	port?: number;
	pid?: number;
	token?: string;
	startedAt?: string;
}

isolatedElectronTest.use({ mintApiToken: true });

isolatedElectronTest.describe("Editor API token", () => {
	isolatedElectronTest(
		"mints a per-launch token, publishes it for the CLI, and rejects unauthenticated pointer calls",
		async ({ page, apiPort, apiToken, stateHome, electronApp }) => {
			isolatedElectronTest.setTimeout(120_000);
			expect(apiToken).toBeNull();
			expect(process.env.QCUT_API_TOKEN).toBeUndefined();
			await createTestProject(page, "API Token");

			const stateUrl = `http://127.0.0.1:${apiPort}/api/claude/pointer/state`;
			const anonymous = await fetch(stateUrl);
			expect(anonymous.status).toBe(401);

			const instancePath = resolve(
				stateHome,
				"qcut-pipeline",
				"instances",
				`${apiPort}.json`
			);
			const instance = JSON.parse(
				await readFile(instancePath, "utf8")
			) as PublishedInstance;
			expect(instance.port).toBe(apiPort);
			expect(instance.pid).toBe(electronApp.process().pid);
			expect(instance.token).toMatch(/^[0-9a-f]{48}$/);

			const wrongToken = await fetch(stateUrl, {
				headers: { Authorization: "Bearer not-the-token" },
			});
			expect(wrongToken.status).toBe(401);
			const authorized = await fetch(stateUrl, {
				headers: { Authorization: `Bearer ${instance.token}` },
			});
			expect(authorized.status).toBe(200);

			// The CLI gets only the port; it must read the published token.
			const pointerState = await runQCutPipelineCli({
				apiPort,
				args: ["editor:pointer:state"],
			});
			const stateEnvelope = pointerState.envelopes.find(
				(candidate) => candidate.status === "ok"
			);
			expect(
				stateEnvelope?.status,
				JSON.stringify(pointerState.envelopes)
			).toBe("ok");

			const instances = await runQCutPipelineCli({
				apiPort,
				args: ["instances", "list"],
			});
			const listed = JSON.stringify(instances.envelopes);
			expect(listed).toContain(`"port":${apiPort}`);

			const evidenceDirectory = resolve(
				"output/playwright/agent-pointer-api-token"
			);
			await mkdir(evidenceDirectory, { recursive: true });
			await writeFile(
				resolve(evidenceDirectory, "evidence.json"),
				JSON.stringify(
					{
						apiPort,
						anonymousStatus: anonymous.status,
						wrongTokenStatus: wrongToken.status,
						authorizedStatus: authorized.status,
						instance: { ...instance, token: "<redacted>" },
						pointerState: pointerState.envelopes,
						instancesList: instances.envelopes,
					},
					null,
					2
				)
			);
		}
	);
});
