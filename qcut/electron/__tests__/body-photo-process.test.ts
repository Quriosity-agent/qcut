import { spawn } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startBodyPhotoProcess } from "../body-photo/body-photo-process";

vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: vi.fn((python: string, args: string[], options) =>
			python === "taskkill.exe"
				? actual.spawn(python, args, options)
				: actual.spawn(process.execPath, ["-e", args[2]], options)
		),
	};
});

function run({
	code,
	type = "verified",
	timeoutMs = 2_000,
}: {
	code: string;
	type?: "ready" | "verified";
	timeoutMs?: number;
}) {
	return startBodyPhotoProcess({
		python: process.execPath,
		arguments: ["fixture.py", code],
		environment: process.env,
		replyType: type,
		timeoutMs,
	});
}
beforeEach(() => {
	vi.mocked(spawn).mockClear();
});

describe("body-photo process ownership", () => {
	it("requires a clean verifier exit after its JSON attestation", async () => {
		const process = run({
			code: "console.log(JSON.stringify({type:'verified',verified:true,onnxruntime:'1.22.1'}))",
		});
		expect(await process.reply).toMatchObject({
			verified: true,
			onnxruntime: "1.22.1",
		});
		await process.closed;
		await process.stop();
		expect(spawn).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining(["-B", "fixture.py"]),
			expect.objectContaining({
				detached: globalThis.process.platform !== "win32",
				windowsHide: true,
			})
		);
	});
	it("rejects a verifier that reports success then crashes", async () => {
		const process = run({
			code: "console.log(JSON.stringify({type:'verified',verified:true}));process.exitCode=7",
		});
		await expect(process.reply).rejects.toThrow("exited (7)");
		await process.stop();
	});
	it("keeps a ready server alive until explicitly stopped", async () => {
		const process = run({
			code: "console.log(JSON.stringify({type:'ready',port:12345,instance:'test'}));setInterval(()=>{},1000)",
			type: "ready",
		});
		expect(await process.reply).toMatchObject({ port: 12345 });
		await process.stop();
		await process.closed;
	});
	it("terminates hung startup and output overflow", async () => {
		const hung = run({ code: "setInterval(()=>{},1000)", timeoutMs: 80 });
		await expect(hung.reply).rejects.toThrow("timed out");
		await hung.closed;
		const oversized = run({
			code: "process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000)",
		});
		await expect(oversized.reply).rejects.toThrow("exceeded");
		await oversized.closed;
	});
	it("does not trust an attestation from a verifier that never exits", async () => {
		const process = run({
			code: "console.log(JSON.stringify({type:'verified',verified:true}));setInterval(()=>{},1000)",
			timeoutMs: 150,
		});
		await expect(process.reply).rejects.toThrow("timed out");
		await process.closed;
	});
	it.skipIf(process.platform === "win32")(
		"reaps descendants holding inherited pipes when a ready host crashes",
		async () => {
			const host = run({
				code: `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:['ignore','inherit','inherit']});
console.log(JSON.stringify({type:'ready',port:12345,childPid:child.pid}));
setTimeout(()=>process.exit(7),80);
`,
				type: "ready",
			});
			const reply = await host.reply;
			await host.closed;
			await vi.waitFor(() => {
				expect(() => process.kill(Number(reply.childPid), 0)).toThrow();
			});
			await host.stop();
		}
	);
});
