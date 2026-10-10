// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { resolveJianyingPortraitMakeupCovers } from "../jianying-portrait-adjustment-runtime/makeup-covers.js";

const metadata = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../jianying-text/jianying-text-style-cover-metadata.js", () => ({
	resolveJianyingResourceCoverUrls: metadata.resolve,
}));

const card = JIANYING_PORTRAIT_MAKEUP_CARDS[2];
const identity = `${card.resourceId}/${card.version}`;
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/WQAAAAASUVORK5CYII=",
	"base64"
);

describe("portrait makeup catalog covers", () => {
	let cacheRoot: string;
	beforeEach(async () => {
		vi.clearAllMocks();
		cacheRoot = await mkdtemp(path.join(os.tmpdir(), "qcut-makeup-cover-"));
		metadata.resolve.mockResolvedValue(
			new Map([[identity, "https://p.byteimg.com/coral.png"]])
		);
	});
	afterEach(async () => {
		await rm(cacheRoot, { recursive: true, force: true });
	});
	const resolve = ({
		fetcher,
		cards = [card],
	}: {
		fetcher: typeof fetch;
		cards?: (typeof card)[];
	}) =>
		resolveJianyingPortraitMakeupCovers({
			cards,
			cacheRoot,
			databaseRoots: ["/private/db", "/installed/db"],
			fetcher,
		});
	it("loads a real cover by exact resource version then works offline", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(png));
		const first = await resolve({ fetcher });
		expect(first.get(card.id)).toBe(
			`data:image/png;base64,${png.toString("base64")}`
		);
		expect(metadata.resolve).toHaveBeenCalledWith({
			databaseRoot: "/private/db",
			references: [{ resourceId: card.resourceId, version: card.version }],
		});
		metadata.resolve.mockResolvedValue(new Map());
		fetcher.mockRejectedValue(new Error("offline"));
		expect(await resolve({ fetcher })).toEqual(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(metadata.resolve).toHaveBeenCalledTimes(2);
	});
	it("does not use another version's cover or a UV texture fallback", async () => {
		metadata.resolve.mockResolvedValue(
			new Map([[`${card.resourceId}/other`, "https://p.byteimg.com/other.png"]])
		);
		const fetcher = vi.fn<typeof fetch>();
		expect(await resolve({ fetcher })).toEqual(new Map());
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("prefers private metadata over the installed catalog", async () => {
		metadata.resolve.mockImplementation(
			async ({ databaseRoot }) =>
				new Map([
					[
						identity,
						`https://p.byteimg.com/${databaseRoot === "/private/db" ? "private" : "installed"}.png`,
					],
				])
		);
		const fetcher = vi.fn<typeof fetch>(async () => new Response(png));
		await resolve({ fetcher });
		expect(fetcher).toHaveBeenCalledWith(
			"https://p.byteimg.com/private.png",
			expect.any(Object)
		);
	});
	it("falls back to the installed cover if a private signed URL fails", async () => {
		metadata.resolve.mockImplementation(
			async ({ databaseRoot }) =>
				new Map([
					[
						identity,
						`https://p.byteimg.com/${databaseRoot === "/private/db" ? "expired" : "fresh"}.png`,
					],
				])
		);
		const fetcher = vi.fn<typeof fetch>(
			async (url) =>
				new Response(String(url).includes("expired") ? "expired" : png, {
					status: String(url).includes("expired") ? 403 : 200,
				})
		);
		expect((await resolve({ fetcher })).has(card.id)).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("degrades to no thumbnail on failed, malformed or oversized downloads", async () => {
		const responses = [
			new Response("failed", { status: 403 }),
			new Response("<html>not an image</html>"),
			new Response(png, {
				headers: { "content-length": String(768 * 1024 + 1) },
			}),
		];
		const fetcher = vi.fn<typeof fetch>(
			async () => responses.shift() ?? new Response("failed")
		);
		await Array.from({ length: 3 }).reduce(async (previous) => {
			await previous;
			expect(await resolve({ fetcher })).toEqual(new Map());
		}, Promise.resolve());
		expect(fetcher).toHaveBeenCalledTimes(3);
	});
	it("rejects untrusted hosts before transmitting a request", async () => {
		metadata.resolve.mockResolvedValue(
			new Map([[identity, "https://example.com/coral.png"]])
		);
		const fetcher = vi.fn<typeof fetch>();
		expect(await resolve({ fetcher })).toEqual(new Map());
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("does not read databases or fetch for an empty card catalog", async () => {
		const fetcher = vi.fn<typeof fetch>();
		expect(await resolve({ fetcher, cards: [] })).toEqual(new Map());
		expect(metadata.resolve).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});
});
