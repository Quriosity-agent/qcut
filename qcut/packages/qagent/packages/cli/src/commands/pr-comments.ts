import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { loadConfig } from "@composio/ao-core";
import { exec } from "../lib/shell.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function scriptsDir(): string {
  // scripts/pr-comments/ lives at the repo root
  return resolve(__dirname, "../../../../scripts/pr-comments");
}

export function registerPRComments(program: Command): void {
  const cmd = program
    .command("pr-comments")
    .description("Export, analyze, and forward PR review comments to agents");

  cmd
    .command("export")
    .description("Export PR review comments to markdown files")
    .argument("<repo>", "GitHub repo (owner/repo)")
    .argument("<pr>", "PR number")
    .argument("[output]", "Output directory")
    .action(async (repo: string, pr: string, output?: string) => {
      const args = [resolve(scriptsDir(), "export.sh"), repo, pr];
      if (output) args.push(output);
      const result = await exec("bash", args);
      console.log(result.stdout);
    });

  cmd
    .command("export-all")
    .description("Export all PR comments (thread + review)")
    .argument("<repo>", "GitHub repo (owner/repo)")
    .argument("<pr>", "PR number")
    .argument("[output]", "Output directory")
    .action(async (repo: string, pr: string, output?: string) => {
      const args = [resolve(scriptsDir(), "export-all.sh"), repo, pr];
      if (output) args.push(output);
      const result = await exec("bash", args);
      console.log(result.stdout);
    });

  cmd
    .command("preprocess")
    .description("Preprocess exported comments into task files")
    .argument("<input>", "Input directory with exported comments")
    .argument("[output]", "Output directory for task files")
    .action(async (input: string, output?: string) => {
      const args = [resolve(scriptsDir(), "batch-preprocess.sh"), input];
      if (output) args.push(output);
      const result = await exec("bash", args);
      console.log(result.stdout);
    });

  cmd
    .command("analyze")
    .description("Show comments grouped by source file")
    .argument("<tasks>", "Tasks directory")
    .action(async (tasks: string) => {
      const result = await exec("bash", [resolve(scriptsDir(), "analyze.sh"), tasks]);
      console.log(result.stdout);
    });

  cmd
    .command("resolve")
    .description("Resolve a PR review thread on GitHub")
    .argument("<repo>", "GitHub repo (owner/repo)")
    .argument("<pr>", "PR number")
    .argument("<comment-id>", "Comment ID")
    .argument("[task-file]", "Task file to move to completed")
    .action(async (repo: string, pr: string, commentId: string, taskFile?: string) => {
      const args = [resolve(scriptsDir(), "resolve-thread.sh"), repo, pr, commentId];
      if (taskFile) args.push(taskFile);
      const result = await exec("bash", args);
      console.log(result.stdout);
    });

  cmd
    .command("forward")
    .description("Export comments and send structured message to an agent session")
    .argument("<session>", "Session ID")
    .action(async (sessionId: string) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);
      const sessions = await sm.list();
      const session = sessions.find((s) => s.id === sessionId);

      if (!session) {
        console.error(chalk.red(`Session not found: ${sessionId}`));
        process.exit(1);
      }

      const prUrl = session.metadata["pr"];
      if (!prUrl) {
        console.error(chalk.red(`Session ${sessionId} has no PR`));
        process.exit(1);
      }

      const project = config.projects[session.projectId];
      if (!project?.repo) {
        console.error(chalk.red(`No repo configured for project ${session.projectId}`));
        process.exit(1);
      }

      const prNum = prUrl.match(/(\d+)\s*$/)?.[1];
      if (!prNum) {
        console.error(chalk.red(`Could not extract PR number from: ${prUrl}`));
        process.exit(1);
      }

      const spinner = ora(`Exporting PR #${prNum} comments...`).start();

      try {
        const scriptPath = resolve(scriptsDir(), "forward-to-agent.sh");
        const result = await exec("bash", [scriptPath, project.repo, prNum]);

        if (!result.stdout.trim()) {
          spinner.succeed("No review comments found");
          return;
        }

        spinner.text = `Sending structured comments to ${sessionId}...`;
        await sm.send(sessionId, result.stdout.trim());
        spinner.succeed(
          `Sent structured review comments to ${chalk.green(sessionId)}`,
        );
      } catch (err) {
        spinner.fail(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
