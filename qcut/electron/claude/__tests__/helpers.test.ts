import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPath, mockHomedir } = vi.hoisted(() => ({
	mockGetPath: vi.fn(),
	mockHomedir: vi.fn(),
}));

vi.mock("electron", () => ({
	app: {
		getPath: mockGetPath,
	},
}));

vi.mock("os", () => ({
	homedir: mockHomedir,
}));

import { getProjectPath } from "../utils/helpers";

describe("claude helpers getProjectPath", () => {
	beforeEach(() => {
		mockGetPath.mockReset();
		mockHomedir.mockReset();
		mockGetPath.mockReturnValue("/mock/Documents");
		mockHomedir.mockReturnValue("/mock-home");
	});

	it("uses Electron documents path when available", () => {
		const result = getProjectPath("project_123");

		expect(mockGetPath).toHaveBeenCalledWith("documents");
		expect(result).toBe(
			path.join("/mock/Documents", "QCut", "Projects", "project_123")
		);
	});

	it("falls back to homedir Documents when app.getPath throws", () => {
		mockGetPath.mockImplementation(() => {
			throw new Error("app.getPath unavailable");
		});

		const result = getProjectPath("project_456");

		expect(mockGetPath).toHaveBeenCalledWith("documents");
		expect(mockHomedir).toHaveBeenCalledOnce();
		expect(result).toBe(
			path.join("/mock-home", "Documents", "QCut", "Projects", "project_456")
		);
	});
});
