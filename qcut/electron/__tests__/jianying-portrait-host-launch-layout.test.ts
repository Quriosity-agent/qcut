// @vitest-environment node
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	lstat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { materializePortraitHostLaunch } from "../jianying-portrait-adjustment-runtime/host-launch-layout";
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
	);
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "qcut-portrait-launch-"));
	roots.push(root);
	const hostPath = path.join(root, "signed-host"),
		frameworkDirectory = path.join(root, "runtime", "Frameworks"),
		cacheRoot = path.join(root, "cache");
	await mkdir(frameworkDirectory, { recursive: true });
	await writeFile(hostPath, "signed executable bytes", { mode: 0o755 });
	await writeFile(
		path.join(frameworkDirectory, "private.dylib"),
		"private payload"
	);
	return { root, hostPath, frameworkDirectory, cacheRoot };
}
describe.skipIf(process.platform === "win32")(
	"portrait signed-host launch layout",
	() => {
		it("preserves host bytes and links external frameworks without copying libraries", async () => {
			const input = await fixture();
			const file = await materializePortraitHostLaunch(input);
			expect(await readFile(file)).toEqual(await readFile(input.hostPath));
			expect((await lstat(file)).mode & 0o111).not.toBe(0);
			expect(await readlink(path.join(path.dirname(file), "Frameworks"))).toBe(
				await realpath(input.frameworkDirectory)
			);
			expect(file.startsWith(input.cacheRoot)).toBe(true);
		});
		it("reuses an intact layout", async () => {
			const input = await fixture();
			const first = await materializePortraitHostLaunch(input);
			expect(await materializePortraitHostLaunch(input)).toBe(first);
		});
		it("binds the cache to both host bytes and canonical runtime identity", async () => {
			const input = await fixture();
			const first = await materializePortraitHostLaunch(input);
			await writeFile(input.hostPath, "new signed bytes");
			const second = await materializePortraitHostLaunch(input);
			expect(second).not.toBe(first);
			const alternate = path.join(input.root, "other-frameworks");
			await mkdir(alternate);
			expect(
				await materializePortraitHostLaunch({
					...input,
					frameworkDirectory: alternate,
				})
			).not.toBe(second);
		});
		it("canonicalizes installed runtime aliases", async () => {
			const input = await fixture();
			const alias = path.join(input.root, "current");
			await symlink(input.frameworkDirectory, alias, "dir");
			expect(
				await materializePortraitHostLaunch({
					...input,
					frameworkDirectory: alias,
				})
			).toBe(await materializePortraitHostLaunch(input));
		});
		it("handles simultaneous materialization without partial publication", async () => {
			const input = await fixture();
			const files = await Promise.all(
				Array.from({ length: 8 }, () => materializePortraitHostLaunch(input))
			);
			expect(new Set(files).size).toBe(1);
			expect(await readFile(files[0])).toEqual(await readFile(input.hostPath));
		});
		it("rejects modified cached executable bytes", async () => {
			const input = await fixture();
			const file = await materializePortraitHostLaunch(input);
			await writeFile(file, "tampered");
			await expect(materializePortraitHostLaunch(input)).rejects.toThrow(
				"modified"
			);
		});
		it("rejects a redirected framework link", async () => {
			const input = await fixture();
			const file = await materializePortraitHostLaunch(input);
			const link = path.join(path.dirname(file), "Frameworks");
			await rm(link);
			await symlink(input.root, link, "dir");
			await expect(materializePortraitHostLaunch(input)).rejects.toThrow(
				"modified"
			);
		});
		it("rejects symlinked source hosts", async () => {
			const input = await fixture();
			const alias = path.join(input.root, "alias-host");
			await symlink(input.hostPath, alias);
			await expect(
				materializePortraitHostLaunch({ ...input, hostPath: alias })
			).rejects.toThrow("regular executable");
		});
		it("rejects symlinked cache roots", async () => {
			const input = await fixture();
			const target = path.join(input.root, "target-cache");
			await mkdir(target);
			await symlink(target, input.cacheRoot, "dir");
			await expect(materializePortraitHostLaunch(input)).rejects.toThrow(
				"regular directory"
			);
		});
		it("rejects non-directory frameworks", async () => {
			const input = await fixture();
			await expect(
				materializePortraitHostLaunch({
					...input,
					frameworkDirectory: input.hostPath,
				})
			).rejects.toThrow("directory");
		});
	}
);
