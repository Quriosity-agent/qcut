/**
 * ScriptInput — step 1: paste screenplay text and trigger LLM parsing.
 */

import { useMoyinStore } from "@/stores/moyin-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Trash2Icon, SparklesIcon } from "lucide-react";

export function ScriptInput() {
	const rawScript = useMoyinStore((s) => s.rawScript);
	const setRawScript = useMoyinStore((s) => s.setRawScript);
	const parseStatus = useMoyinStore((s) => s.parseStatus);
	const parseError = useMoyinStore((s) => s.parseError);
	const parseScript = useMoyinStore((s) => s.parseScript);
	const clearScript = useMoyinStore((s) => s.clearScript);

	const isParsing = parseStatus === "parsing";
	const canParse = rawScript.trim().length > 0 && !isParsing;

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<label
					htmlFor="moyin-script-input"
					className="text-xs font-medium text-muted-foreground"
				>
					Paste your screenplay or story text
				</label>
				<Textarea
					id="moyin-script-input"
					value={rawScript}
					onChange={(e) => setRawScript(e.target.value)}
					placeholder="Paste screenplay text here... Supports any language."
					className="min-h-[200px] resize-y text-sm font-mono"
					disabled={isParsing}
				/>
			</div>

			{parseError && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
					{parseError}
				</div>
			)}

			<div className="flex items-center gap-2">
				<Button
					onClick={parseScript}
					disabled={!canParse}
					className="flex-1"
					size="sm"
				>
					{isParsing ? (
						<>
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
							Parsing...
						</>
					) : (
						<>
							<SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
							Parse Script
						</>
					)}
				</Button>

				{rawScript.length > 0 && (
					<Button
						variant="outline"
						size="sm"
						onClick={clearScript}
						disabled={isParsing}
					>
						<Trash2Icon className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>

			<p className="text-xs text-muted-foreground">
				AI will extract characters, scenes, and story structure from your text.
			</p>
		</div>
	);
}
