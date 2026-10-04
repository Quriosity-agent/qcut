// @vitest-environment node
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBeautyLabLiveCandidateResult } from "../beauty-lab-live-candidate-result.js";
import * as researchFiles from "../beauty-lab-research-files.js";
import {
	digest,
	setupFiles,
	setupResultJob,
	successfulJob,
} from "./beauty-lab-live-candidate-fixture.js";

let root: string;
let files: Awaited<ReturnType<typeof setupFiles>>;
let job: Awaited<ReturnType<typeof successfulJob>>;
let input: Parameters<typeof readBeautyLabLiveCandidateResult>[0];
let auditPath: string;
let configPath: string;
let hostSnapshotPath: string;
let receiptSnapshotPath: string;

beforeEach(async () => {
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-live-host-receipt-"))
	);
	({ files, job, input } = await setupResultJob({ root }));
	const { directory } = input;
	auditPath = path.join(directory, "audit/report.json");
	configPath = path.join(directory, "audit/lldb-config.json");
	hostSnapshotPath = path.join(directory, "audit/live-host.snapshot");
	receiptSnapshotPath = path.join(directory, "audit/live-host-receipt.json");
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

async function saveAudit({
	patch = {},
}: {
	patch?: Record<string, unknown>;
} = {}) {
	await writeFile(auditPath, JSON.stringify({ ...job.audit, ...patch }));
}

async function saveReceipt({ value }: { value: unknown }) {
	const bytes = Buffer.from(JSON.stringify(value));
	await writeFile(receiptSnapshotPath, bytes);
	job.audit.dependencies.files[files.receiptPath] = digest({ data: bytes });
	job.audit.artifacts["live-host-receipt.json"].sha256 = digest({
		data: bytes,
	});
	await saveAudit();
}

async function saveConfig({ bytes }: { bytes: Buffer }) {
	await writeFile(configPath, bytes);
	job.audit.artifacts["lldb-config.json"].sha256 = digest({ data: bytes });
	await saveAudit();
}

describe("live host receipt binding (synthetic files, no codesign or native launch)", () => {
	it.each([
		false,
		true,
	])("accepts a bound host with reused=%s", async (reused) => {
		job.audit.host_identity.reused = reused;
		await saveAudit();
		const result = await readBeautyLabLiveCandidateResult(input);
		expect(result.rgba).toEqual(new Uint8Array(8).fill(42));
		expect(result.provenance?.dependenciesSha256).toBe(
			digest({ data: Buffer.from(JSON.stringify(job.audit.dependencies)) })
		);
		expect(JSON.stringify(result)).not.toContain(
			"synthetic-private-launch-token"
		);
	});

	it("accepts completed audit evidence after another recipe replaces the cache", async () => {
		const nextBytes = Buffer.from("next recipe signed host; never executed");
		const nextReceipt = {
			...files.hostReceipt,
			recipe: "e".repeat(64),
			sha256: digest({ data: nextBytes }),
			signature: { ...files.hostReceipt.signature, cdhash: "d".repeat(40) },
		};
		const nextHost = path.join(files.hostDirectory, "next-host");
		const nextReceiptPath = path.join(files.hostDirectory, "next-receipt.json");
		await writeFile(nextHost, nextBytes);
		await writeFile(nextReceiptPath, JSON.stringify(nextReceipt));
		await rename(nextHost, files.hostPath);
		await rename(nextReceiptPath, files.receiptPath);
		await expect(
			readBeautyLabLiveCandidateResult(input)
		).resolves.toHaveProperty("rgba", new Uint8Array(8).fill(42));
	});

	it("does not require current cache files to consume a completed audit", async () => {
		await rm(files.hostPath);
		await rm(files.receiptPath);
		await expect(
			readBeautyLabLiveCandidateResult(input)
		).resolves.toHaveProperty("rgba");
	});

	it("compares receipt structure independently of JSON property order", async () => {
		await saveReceipt({
			value: {
				signature: Object.fromEntries(
					Object.entries(files.hostReceipt.signature).reverse()
				),
				identity: files.hostReceipt.identity,
				sha256: files.hostReceipt.sha256,
				recipe: files.hostReceipt.recipe,
			},
		});
		await expect(
			readBeautyLabLiveCandidateResult(input)
		).resolves.toHaveProperty("rgba");
	});

	it("requires the host identity record", async () => {
		await saveAudit({ patch: { host_identity: undefined } });
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		{ recipe: "not-a-hash" },
		{ sha256: "a".repeat(63) },
		{ identity: "a".repeat(40) },
		{ identity: "A".repeat(39) },
		{ identity: undefined },
		{ signature: undefined },
		{ reused: "true" },
		{ permission_granted_by_launcher: true },
		{ permission_granted_by_launcher: undefined },
		{ desktop_authorization: undefined },
		{ extra: "unrecognized" },
	])("rejects malformed host identity: %j", async (patch) => {
		await saveAudit({
			patch: { host_identity: { ...job.audit.host_identity, ...patch } },
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		{ identifier: "com.other.live-host" },
		{ identifier: undefined },
		{ team: "short" },
		{ team: "TEAM-ID!!!" },
		{ cdhash: "z".repeat(40) },
		{ cdhash: "a".repeat(39) },
		{ requirement: "" },
		{ requirement: "   " },
		{ requirement: "invalid\0requirement" },
		{ extra: true },
	])("rejects malformed audit signature: %j", async (patch) => {
		await saveAudit({
			patch: {
				host_identity: {
					...job.audit.host_identity,
					signature: { ...files.hostReceipt.signature, ...patch },
				},
			},
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		{ recipe: "d".repeat(64) },
		{ sha256: "e".repeat(64) },
		{ identity: "B".repeat(40) },
		{
			signature: {
				identifier: "com.qcut.beauty-lab.live-host",
				team: "OTHERTEAM1",
				cdhash: "c".repeat(40),
				requirement: "different verified requirement",
			},
		},
	])("rejects a different receipt even with its updated dependency hash: %j", async (patch) => {
		await saveReceipt({ value: { ...files.hostReceipt, ...patch } });
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/receipt differs/
		);
	});

	it.each([
		{ team: "OTHERTEAM1" },
		{ cdhash: "c".repeat(40) },
		{ requirement: "different verified requirement" },
	])("binds every signature field to the audit: %j", async (patch) => {
		await saveReceipt({
			value: {
				...files.hostReceipt,
				signature: { ...files.hostReceipt.signature, ...patch },
			},
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/receipt differs/
		);
	});

	it.each([
		{ extra: true },
		{ identity: undefined },
		{ identity: "a".repeat(40) },
		{ signature: { identifier: "com.other.host" } },
	])("requires the exact receipt schema: %j", async (patch) => {
		await saveReceipt({ value: { ...files.hostReceipt, ...patch } });
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		"host",
		"receipt",
	] as const)("requires the %s dependency hash", async (kind) => {
		const target = kind === "host" ? files.hostPath : files.receiptPath;
		job.audit.dependencies.files = Object.fromEntries(
			Object.entries(job.audit.dependencies.files).filter(
				([key]) => key !== target
			)
		);
		await saveAudit();
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/dependency binding/
		);
	});

	it.each([
		"host",
		"receipt",
	] as const)("rejects the wrong %s dependency hash", async (kind) => {
		const target = kind === "host" ? files.hostPath : files.receiptPath;
		job.audit.dependencies.files[target] = "0".repeat(64);
		await saveAudit();
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/binding|SHA mismatch/
		);
	});

	it.each([
		"live-host.snapshot",
		"live-host-receipt.json",
		"lldb-config.json",
	])("rejects tampered %s bytes", async (name) => {
		const target = path.join(input.directory, "audit", name);
		await writeFile(
			target,
			Buffer.concat([await readFile(target), Buffer.from(" ")])
		);
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/SHA mismatch|LLDB host binding/
		);
	});

	it.each([
		"missing",
		"symlink",
		"directory",
		"oversized",
	])("rejects a %s host snapshot", async (kind) => {
		if (kind === "oversized") {
			await truncate(hostSnapshotPath, 32 * 1024 ** 2 + 1);
		} else {
			const bytes = await readFile(hostSnapshotPath);
			await rm(hostSnapshotPath);
			if (kind === "directory") await mkdir(hostSnapshotPath);
			if (kind === "symlink") {
				const alias = path.join(input.directory, "audit", "alias");
				await writeFile(alias, bytes);
				await symlink(alias, hostSnapshotPath);
			}
		}
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		"live-host-receipt.json",
		"lldb-config.json",
	])("rejects missing %s", async (name) => {
		await rm(path.join(input.directory, "audit", name));
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow();
	});

	it.each([
		"live-host.snapshot",
		"live-host-receipt.json",
	] as const)("requires the %s artifact hash", async (name) => {
		await saveAudit({
			patch: {
				artifacts: Object.fromEntries(
					Object.entries(job.audit.artifacts).filter(([key]) => key !== name)
				),
			},
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/snapshot artifact binding/
		);
	});

	it.each([
		"live-host.snapshot",
		"live-host-receipt.json",
	] as const)("rejects a %s artifact hash that differs from the external dependency", async (name) => {
		job.audit.artifacts[name].sha256 = "f".repeat(64);
		await saveAudit();
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/snapshot artifact binding/
		);
	});

	it.each([
		"relative",
		"alias",
		"normalized",
	])("rejects a %s host root", async (kind) => {
		let hostDirectory = path.relative(process.cwd(), files.hostDirectory);
		if (kind === "alias") {
			hostDirectory = path.join(root, "host-alias");
			await symlink(files.hostDirectory, hostDirectory);
		}
		if (kind === "normalized")
			hostDirectory = `${files.hostDirectory}/../beauty-live-host`;
		await expect(
			readBeautyLabLiveCandidateResult({ ...input, hostDirectory })
		).rejects.toThrow();
	});

	it.each([
		"wrong-host",
		"sibling-prefix",
		"relative",
	])("rejects %s in host identity", async (kind) => {
		job.audit.host_identity.path =
			kind === "relative"
				? "live-host"
				: kind === "sibling-prefix"
					? `${files.hostDirectory}-other/live-host`
					: path.join(files.hostDirectory, "other-host");
		await saveAudit();
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/path or dependency/
		);
	});

	it.each([
		undefined,
		42,
		"/foreign/live-host",
	])("rejects LLDB host %j even with a matching config hash", async (host) => {
		await saveConfig({
			bytes: Buffer.from(JSON.stringify({ host, token: "private-test-token" })),
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			"invalid live LLDB host binding"
		);
	});

	it("requires the LLDB config artifact hash", async () => {
		await saveAudit({
			patch: {
				artifacts: Object.fromEntries(
					Object.entries(job.audit.artifacts).filter(
						([key]) => key !== "lldb-config.json"
					)
				),
			},
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			"invalid live LLDB host binding"
		);
	});

	it("rejects launching the audit snapshot instead of the fixed cache host", async () => {
		await saveConfig({
			bytes: Buffer.from(JSON.stringify({ host: hostSnapshotPath })),
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			"invalid live LLDB host binding"
		);
	});

	it("does not expose the token or parse context on malformed LLDB JSON", async () => {
		await saveConfig({
			bytes: Buffer.from('{"token":"private-test-token", invalid}'),
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toEqual(
			new Error("Beauty Lab research: invalid live LLDB host binding")
		);
	});

	it.each([
		"live-host.snapshot",
		"live-host-receipt.json",
		"lldb-config.json",
	])("rechecks %s before publishing pixels", async (kind) => {
		const target = path.join(input.directory, "audit", kind);
		const createSnapshot = researchFiles.createSnapshot;
		vi.spyOn(researchFiles, "createSnapshot").mockImplementation(() => {
			const snapshot = createSnapshot();
			return {
				...snapshot,
				read: async (options) => {
					const bytes = await snapshot.read(options);
					if (options.relativePath === "candidate.rgba")
						await writeFile(target, "changed after receipt validation");
					return bytes;
				},
			};
		});
		await expect(readBeautyLabLiveCandidateResult(input)).rejects.toThrow(
			/file changed during load/
		);
	});
});
