"use client";

import {
	PlatformCapability,
	type PlatformCliLauncherAPI,
	type PlatformCliLauncherState,
	platform,
} from "@qcut/platform-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/**
 * About & updates → command line tool: installs a `qcut` command on PATH that
 * runs the tool bundled with this very app, so it never lags behind the app.
 */

function resolveCliLauncher(): PlatformCliLauncherAPI | undefined {
	try {
		const current = platform();
		if (!current.hasCapability(PlatformCapability.Updates)) return undefined;
		return current.updates.cliLauncher;
	} catch {
		return undefined;
	}
}

function parentDir(filePath: string): string {
	return filePath.replace(/[\\/][^\\/]+$/, "");
}

function describeState({
	state,
	t,
}: {
	state: PlatformCliLauncherState;
	t: ReturnType<typeof useTranslation>["t"];
}): string[] {
	const lines: string[] = [];
	if (!state.installed) {
		lines.push(t("updates.cliNotInstalled", { path: state.path }));
	} else if (state.managed) {
		lines.push(t("updates.cliInstalled", { path: state.path }));
	} else {
		lines.push(t("updates.cliForeign", { path: state.path }));
	}
	if (state.installed && !state.onPath) {
		lines.push(t("updates.cliNotOnPath", { dir: parentDir(state.path) }));
	}
	if (state.shadowedBy.length > 0) {
		lines.push(t("updates.cliShadowed", { path: state.shadowedBy[0] }));
	}
	return lines;
}

export function CliLauncherSection() {
	const { t } = useTranslation();
	const api = useMemo(resolveCliLauncher, []);
	const [state, setState] = useState<PlatformCliLauncherState | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!api) return;
		let active = true;
		void api
			.getState()
			.then((next) => {
				if (active) setState(next);
			})
			.catch(() => {
				// Leave the section at "unknown"; the install button still works.
			});
		return () => {
			active = false;
		};
	}, [api]);

	const install = useCallback(async () => {
		if (!api) return;
		setBusy(true);
		try {
			const outcome = await api.install({ replaceForeign: true });
			if (!outcome.success) {
				toast.error(t("updates.cliInstallFailed", { error: outcome.error }));
				return;
			}
			setState(outcome.state);
			toast.success(
				t("updates.cliInstalledToast", { path: outcome.state.path })
			);
		} catch (error) {
			toast.error(
				t("updates.cliInstallFailed", {
					error: error instanceof Error ? error.message : String(error),
				})
			);
		} finally {
			setBusy(false);
		}
	}, [api, t]);

	if (!api) return null;

	const lines = state
		? describeState({ state, t })
		: [t("updates.cliChecking")];
	const installed = state?.installed === true && state.managed;

	return (
		<section className="space-y-3" data-testid="cli-launcher-section">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 space-y-1">
					<h3 className="text-sm font-medium">{t("updates.cliTitle")}</h3>
					<p className="text-xs text-muted-foreground">
						{t("updates.cliDescription")}
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					variant={installed ? "outline" : "default"}
					disabled={busy}
					onClick={() => void install()}
					data-testid="cli-launcher-install"
				>
					{installed ? t("updates.cliReinstall") : t("updates.cliInstall")}
				</Button>
			</div>
			<ul className="space-y-1 text-xs text-muted-foreground">
				{lines.map((line) => (
					<li key={line} className="break-all">
						{line}
					</li>
				))}
			</ul>
		</section>
	);
}
