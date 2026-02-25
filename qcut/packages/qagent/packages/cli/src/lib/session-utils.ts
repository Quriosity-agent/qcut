import type { OrchestratorConfig } from "@composio/ao-core";

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check whether a session name matches a project prefix (strict: prefix-\d+ only). */
export function matchesPrefix(sessionName: string, prefix: string): boolean {
  return new RegExp(`^${escapeRegex(prefix)}-\\d+$`).test(sessionName);
}

/** Find which project a session belongs to by matching its name against session prefixes. */
export function findProjectForSession(
  config: OrchestratorConfig,
  sessionName: string,
): string | null {
  for (const [id, project] of Object.entries(config.projects)) {
    const prefix = project.sessionPrefix || id;
    if (matchesPrefix(sessionName, prefix)) {
      return id;
    }
  }
  return null;
}
