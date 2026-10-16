import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { fireEvent, render, screen, waitFor } from "@/test/test-utils";
import type {
	PlatformCliLauncherInstallOutcome,
	PlatformCliLauncherState,
} from "@qcut/platform-core";
import { useLocaleStore } from "@/stores/locale-store";

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mocks = vi.hoisted(() => {
	const notInstalled: PlatformCliLauncherState = {
		path: "/Users/me/.local/bin/qcut",
		installed: false,
		managed: false,
		onPath: true,
		shadowedBy: [],
	};
	const installed: PlatformCliLauncherState = {
		...notInstalled,
		installed: true,
		managed: true,
		target: {
			executablePath: "/Applications/QCut.app/Contents/MacOS/QCut",
			cliScriptPath:
				"/Applications/QCut.app/Contents/Resources/app.asar/cli.js",
		},
	};
	return {
		notInstalled,
		installed,
		hasCapability: true,
		state: notInstalled as PlatformCliLauncherState,
		cliLauncher: {
			getState: vi.fn(async () => mocks.state),
			install: vi.fn(
				async (): Promise<PlatformCliLauncherInstallOutcome> => ({
					success: true,
					state: installed,
				})
			),
		},
	};
});

vi.mock("@qcut/platform-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@qcut/platform-core")>();
	return {
		...actual,
		platform: () => ({
			hasCapability: () => mocks.hasCapability,
			updates: { cliLauncher: mocks.cliLauncher },
		}),
	};
});

import { CliLauncherSection } from "../cli-launcher-section";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.hasCapability = true;
	mocks.state = mocks.notInstalled;
	mocks.cliLauncher.install.mockResolvedValue({
		success: true,
		state: mocks.installed,
	});
	useLocaleStore.getState().setLocale({ locale: "en" });
});

describe("CliLauncherSection", () => {
	it("offers to install, then shows where the launcher went", async () => {
		render(<CliLauncherSection />);

		expect(
			await screen.findByText(
				"Not installed · will be written to /Users/me/.local/bin/qcut"
			)
		).toBeInTheDocument();
		const button = screen.getByTestId("cli-launcher-install");
		expect(button).toHaveTextContent("Install command line tool");

		fireEvent.click(button);

		await waitFor(() => {
			expect(mocks.cliLauncher.install).toHaveBeenCalledWith({
				replaceForeign: true,
			});
		});
		expect(
			await screen.findByText("Installed · /Users/me/.local/bin/qcut")
		).toBeInTheDocument();
		expect(button).toHaveTextContent("Reinstall");
		expect(toast.success).toHaveBeenCalledWith(
			"qcut installed at /Users/me/.local/bin/qcut"
		);
	});

	it("warns about a foreign file, a folder off PATH and a qcut that shadows it", async () => {
		mocks.state = {
			...mocks.notInstalled,
			installed: true,
			managed: false,
			onPath: false,
			shadowedBy: ["/Users/me/.bun/bin/qcut"],
		};
		render(<CliLauncherSection />);

		expect(
			await screen.findByText(
				"/Users/me/.local/bin/qcut is a qcut command QCut did not write; installing replaces it"
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"/Users/me/.local/bin is not on PATH; add it so terminals find qcut"
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"PATH runs /Users/me/.bun/bin/qcut first; remove it or move QCut's folder earlier in PATH"
			)
		).toBeInTheDocument();
	});

	it("reports an install that failed", async () => {
		mocks.cliLauncher.install.mockResolvedValue({
			success: false,
			reason: "write-failed",
			error: "EACCES: permission denied",
		});
		render(<CliLauncherSection />);
		await screen.findByText(
			"Not installed · will be written to /Users/me/.local/bin/qcut"
		);

		fireEvent.click(screen.getByTestId("cli-launcher-install"));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Could not install the qcut command: EACCES: permission denied"
			);
		});
		expect(
			screen.getByText(
				"Not installed · will be written to /Users/me/.local/bin/qcut"
			)
		).toBeInTheDocument();
	});

	it("renders nothing without the updates capability", () => {
		mocks.hasCapability = false;
		render(<CliLauncherSection />);
		expect(screen.queryByTestId("cli-launcher-section")).toBeNull();
	});
});
