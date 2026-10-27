import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveStickerLabRootOverride } from "../sticker-lab-root";

describe("Sticker Lab CLI root selection", () => {
	let profile: string;
	beforeEach(() => {
		profile = fs.mkdtempSync(path.join(tmpdir(), "qcut-cli-root-"));
		vi.stubEnv("QCUT_USER_DATA_DIR", profile);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(profile, { recursive: true, force: true });
	});
	test("prefers a non-empty explicit root over the environment", () => {
		expect(
			resolveStickerLabRootOverride({
				root: "  /explicit/stickers  ",
				environment: { QCUT_STICKER_LAB_ROOT: "/configured/stickers" },
			})
		).toBe("/explicit/stickers");
	});

	test("uses a non-empty configured root when the explicit root is absent", () => {
		expect(
			resolveStickerLabRootOverride({
				environment: {
					QCUT_STICKER_LAB_ROOT: "  /configured/stickers  ",
				},
			})
		).toBe("/configured/stickers");
	});

	test("leaves the root undefined when both selectors are blank", () => {
		expect(
			resolveStickerLabRootOverride({
				root: "  ",
				environment: { QCUT_STICKER_LAB_ROOT: "\t" },
				userDataPath: profile,
			})
		).toBeUndefined();
	});
});
