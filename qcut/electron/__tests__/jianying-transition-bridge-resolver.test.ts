// @vitest-environment node
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	bridgeAdvertises,
	JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES,
	JIANYING_TRANSITION_FINISH_CAPABILITY,
	jianyingTransitionBridgeCompilerArguments,
	qcutPrivateRuntimeBridgePath,
	resolveJianyingTransitionBridge,
} from "../jianying-transition/bridge-resolver.js";

const OLD_USAGE =
	"Usage: bridge <runtime-root> <inspect|transition|transition-video|effect-video>";
const NEW_USAGE = `${OLD_USAGE}\nCapabilities: ${JIANYING_TRANSITION_FINISH_CAPABILITY}`;

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
	delete process.env.QCUT_JIANYING_TRANSITION_BRIDGE;
});

/** A stand-in bridge: prints `usage` like the real one, and counts its runs. */
function fakeBridge({
	usage,
	name = "bridge",
}: {
	usage: string;
	name?: string;
}) {
	const directory = mkdtempSync(path.join(tmpdir(), "qcut-bridge-test-"));
	directories.push(directory);
	const bridgePath = path.join(directory, name);
	const runsPath = path.join(directory, "runs");
	writeFileSync(runsPath, "");
	writeFileSync(
		bridgePath,
		`#!/bin/sh\necho run >> '${runsPath}'\ncat >&2 <<'USAGE'\n${usage}\nUSAGE\nexit 2\n`
	);
	chmodSync(bridgePath, 0o755);
	return {
		bridgePath,
		runs: () =>
			readFileSync(runsPath, "utf8").split("\n").filter(Boolean).length,
	};
}

describe("Jianying transition bridge resolver", () => {
	it("resolves the user-local QCut runtime bridge path", () => {
		expect(
			qcutPrivateRuntimeBridgePath({ homeDirectory: "/Users/tester" })
		).toBe(
			path.join(
				"/Users/tester",
				"Library",
				"Application Support",
				"QCut",
				"RuntimeBridges",
				"jianying-transition-bridge"
			)
		);
	});

	it("links every probe dependency and required macOS framework", () => {
		const sourceDirectory = "/fixture/probe";
		const outputPath = "/fixture/bin/jianying-transition-bridge";
		const arguments_ = jianyingTransitionBridgeCompilerArguments({
			sourceDirectory,
			outputPath,
		});
		const compiledSources = JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES.filter(
			(name) => name.endsWith(".mm") || name.endsWith(".cpp")
		).map((name) => path.join(sourceDirectory, name));

		expect(compiledSources).toEqual(
			expect.arrayContaining([
				path.join(sourceDirectory, "graphics-runtime.mm"),
				path.join(sourceDirectory, "filter-probe.mm"),
				path.join(sourceDirectory, "filter-sequence-io.cpp"),
				path.join(sourceDirectory, "text-probe.mm"),
				path.join(sourceDirectory, "text-resource-finder.mm"),
			])
		);
		expect(arguments_).toEqual(
			expect.arrayContaining([
				...compiledSources,
				"AppKit",
				"CoreVideo",
				"IOSurface",
				"OpenGL",
			])
		);
		expect(arguments_.slice(-2)).toEqual(["-o", outputPath]);
	});
});

describe.skipIf(process.platform === "win32")(
	"what a bridge binary says it can do",
	() => {
		it("is read from its usage text: its modes, and what it does beyond them", async () => {
			const old = fakeBridge({ usage: OLD_USAGE });
			const current = fakeBridge({ usage: NEW_USAGE });
			const finish = [JIANYING_TRANSITION_FINISH_CAPABILITY];

			expect(
				await bridgeAdvertises({
					bridgePath: old.bridgePath,
					tokens: ["effect-video"],
				})
			).toBe(true);
			// It has every mode, starts and renders: only this tells it apart.
			expect(
				await bridgeAdvertises({ bridgePath: old.bridgePath, tokens: finish })
			).toBe(false);
			expect(
				await bridgeAdvertises({
					bridgePath: current.bridgePath,
					tokens: ["transition-video", ...finish],
				})
			).toBe(true);
			// Nothing asked, nothing run.
			const unasked = fakeBridge({ usage: OLD_USAGE });
			expect(
				await bridgeAdvertises({ bridgePath: unasked.bridgePath, tokens: [] })
			).toBe(true);
			expect(unasked.runs()).toBe(0);
		});

		it("asks a binary once, and again when its file changes", async () => {
			const bridge = fakeBridge({ usage: OLD_USAGE });
			const tokens = [JIANYING_TRANSITION_FINISH_CAPABILITY];
			expect(
				await bridgeAdvertises({ bridgePath: bridge.bridgePath, tokens })
			).toBe(false);
			expect(
				await bridgeAdvertises({
					bridgePath: bridge.bridgePath,
					tokens: ["effect-video"],
				})
			).toBe(true);
			expect(bridge.runs()).toBe(1);

			// The same path, rebuilt with the fix.
			const rebuilt = fakeBridge({ usage: NEW_USAGE });
			writeFileSync(bridge.bridgePath, readFileSync(rebuilt.bridgePath));
			expect(
				await bridgeAdvertises({ bridgePath: bridge.bridgePath, tokens })
			).toBe(true);
		});
	}
);

describe("the bridge that says it finishes transition frames", () => {
	const source = (name: string) =>
		readFileSync(
			path.resolve(__dirname, "../../research/jianying-runtime-probe", name),
			"utf8"
		);

	it("is the one whose source waits for the engine after each seek", () => {
		// The word in the usage text is a claim about transition-probe.mm;
		// one must not outlive the other.
		expect(source("probe.mm")).toContain(
			`Capabilities: ${JIANYING_TRANSITION_FINISH_CAPABILITY}`
		);
		const transition = source("transition-probe.mm");
		const seek = transition.indexOf("symbols_.seekManagerDeviceTextureApi(");
		const finish = transition.indexOf(
			"symbols_.finishRenderer(engineRenderer_)"
		);
		expect(seek).toBeGreaterThan(-1);
		expect(finish).toBeGreaterThan(seek);
		// Before the frame is handed back to be read.
		expect(finish).toBeLessThan(
			transition.indexOf("return frameReady && seekResult == 0;")
		);
	});
});

describe.skipIf(process.platform !== "darwin")("choosing a bridge", () => {
	it("takes a bridge that has what is asked of it", async () => {
		const current = fakeBridge({ usage: NEW_USAGE });
		process.env.QCUT_JIANYING_TRANSITION_BRIDGE = current.bridgePath;
		expect(
			await resolveJianyingTransitionBridge({
				allowCompile: false,
				requiredCapability: JIANYING_TRANSITION_FINISH_CAPABILITY,
			})
		).toBe(current.bridgePath);
	});

	it("passes over one built before the capability, though it comes first", async () => {
		const old = fakeBridge({ usage: OLD_USAGE });
		process.env.QCUT_JIANYING_TRANSITION_BRIDGE = old.bridgePath;
		// Asked for nothing, the first bridge that runs is taken.
		expect(await resolveJianyingTransitionBridge({ allowCompile: false })).toBe(
			old.bridgePath
		);
		// Asked for the capability, it is not; whatever else this machine
		// has is looked at instead.
		expect(
			await resolveJianyingTransitionBridge({
				allowCompile: false,
				requiredCapability: JIANYING_TRANSITION_FINISH_CAPABILITY,
			})
		).not.toBe(old.bridgePath);
		expect(
			await resolveJianyingTransitionBridge({
				allowCompile: false,
				requiredMode: "effect-video",
			})
		).toBe(old.bridgePath);
	});
});
