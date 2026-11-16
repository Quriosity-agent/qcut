import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAccess,
	mockCopyFile,
	mockDeleteMetadata,
	mockDiscardStaged,
	mockLink,
	mockLstat,
	mockPersistMetadata,
	mockReadMetadata,
	mockReaddir,
	mockRename,
	mockStageMetadata,
	mockStat,
	mockUnlink,
} = vi.hoisted(() => ({
	mockAccess: vi.fn(),
	mockCopyFile: vi.fn(),
	mockDeleteMetadata: vi.fn(),
	mockDiscardStaged: vi.fn(),
	mockLink: vi.fn(),
	mockLstat: vi.fn(),
	mockPersistMetadata: vi.fn(),
	mockStageMetadata: vi.fn(),
	mockReadMetadata: vi.fn(),
	mockReaddir: vi.fn(),
	mockRename: vi.fn(),
	mockStat: vi.fn(),
	mockUnlink: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/mock/Documents") },
	ipcMain: { handle: vi.fn() },
}));

vi.mock("electron-log", () => ({
	default: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock("fs/promises", () => ({
	access: (...args: unknown[]) => mockAccess(...args),
	constants: { COPYFILE_EXCL: 1 },
	copyFile: (...args: unknown[]) => mockCopyFile(...args),
	link: (...args: unknown[]) => mockLink(...args),
	lstat: (...args: unknown[]) => mockLstat(...args),
	readdir: (...args: unknown[]) => mockReaddir(...args),
	rename: (...args: unknown[]) => mockRename(...args),
	stat: (...args: unknown[]) => mockStat(...args),
	unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock("../claude/handlers/claude-media-restricted-metadata.js", () => ({
	deleteMediaRestrictedMetadata: (...args: unknown[]) =>
		mockDeleteMetadata(...args),
	persistMediaRestrictedMetadata: (...args: unknown[]) =>
		mockPersistMetadata(...args),
	readMediaRestrictedMetadata: (...args: unknown[]) =>
		mockReadMetadata(...args),
	RestrictedMetadataTakenError: class extends Error {},
	stageMediaRestrictedMetadata: (...args: unknown[]) =>
		mockStageMetadata(...args),
}));

import {
	deleteMediaFile,
	renameMediaFile,
} from "../claude/handlers/claude-media-handler.js";

const OLD_ID = `media_${Buffer.from("reference.gif").toString("base64url")}`;
const NEW_ID = `media_${Buffer.from("renamed.gif").toString("base64url")}`;
const METADATA = {
	animatedSticker: true,
	batchId: "jianying-2026-08-23-batch-18-v2",
	checksumSha256:
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	itemId: "42001",
	redistribution: "prohibited",
	referenceOnly: true,
	source: "sticker-lab",
	usage: "internal-reference-only",
} as const;

describe("restricted metadata rename rollback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAccess.mockImplementation(async (target: unknown) => {
			if (String(target).endsWith("renamed.gif")) throw new Error("ENOENT");
		});
		mockReaddir.mockImplementation(async (target: unknown) => {
			if (String(target).replaceAll("\\", "/").endsWith("/media")) {
				return [
					{
						isFile: () => true,
						isSymbolicLink: () => false,
						name: "reference.gif",
					},
				];
			}
			return [];
		});
		mockStat.mockResolvedValue({
			birthtimeMs: 1,
			mtimeMs: 2,
			size: 6,
		});
		mockReadMetadata.mockResolvedValue(METADATA);
		mockPersistMetadata.mockResolvedValue(undefined);
		mockDiscardStaged.mockResolvedValue(undefined);
		mockStageMetadata.mockResolvedValue({ discard: mockDiscardStaged });
		mockDeleteMetadata.mockResolvedValue(undefined);
		// The file cannot be moved: neither by a hard link nor by a copy.
		mockLstat.mockResolvedValue({ isSymbolicLink: () => false });
		mockLink.mockRejectedValue(
			Object.assign(new Error("link refused"), { code: "EPERM" })
		);
		mockCopyFile.mockRejectedValue(new Error("copy refused"));
		mockRename.mockRejectedValue(new Error("rename refused"));
		mockUnlink.mockResolvedValue(undefined);
	});

	it("removes the staged new sidecar and retains the old one", async () => {
		await expect(
			renameMediaFile("project-1", OLD_ID, "renamed.gif")
		).resolves.toBe(false);

		expect(mockLink).toHaveBeenCalledOnce();
		expect(mockCopyFile).toHaveBeenCalledOnce();
		// Never by a plain rename, which would replace a file at the name.
		expect(mockRename).not.toHaveBeenCalled();
		expect(mockStageMetadata).toHaveBeenCalledWith({
			mediaId: NEW_ID,
			metadata: METADATA,
			projectId: "project-1",
			mediaFileExists: expect.any(Function),
		});
		// What was staged is taken away by the one who staged it, and nothing
		// is removed by id: the old sidecar stays, and so would another
		// file's under the new id.
		expect(mockDiscardStaged).toHaveBeenCalledOnce();
		expect(mockDeleteMetadata).not.toHaveBeenCalled();
	});

	it("returns success after media deletion when orphan cleanup fails", async () => {
		mockDeleteMetadata.mockRejectedValueOnce(new Error("sidecar busy"));

		await expect(deleteMediaFile("project-1", OLD_ID)).resolves.toBe(true);

		expect(mockUnlink).toHaveBeenCalledWith(
			path.join(
				"/mock/Documents",
				"QCut",
				"Projects",
				"project-1",
				"media",
				"reference.gif"
			)
		);
		expect(mockDeleteMetadata).toHaveBeenCalledWith({
			mediaId: OLD_ID,
			projectId: "project-1",
		});
	});
});
