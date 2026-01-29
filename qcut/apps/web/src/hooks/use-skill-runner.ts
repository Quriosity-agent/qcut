import { useCallback } from "react";
import { useSkillsStore } from "@/stores/skills-store";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";
import { useProjectStore } from "@/stores/project-store";
import type { CliProvider } from "@/types/cli-provider";

/**
 * Hook to run a skill with the configured CLI provider.
 *
 * When a skill is run:
 * 1. Sets the skill as active context in the PTY terminal store
 * 2. Sets the CLI provider (Gemini or Codex if specified)
 * 3. Sets the working directory to the project's skills folder
 * 4. Switches to the PTY terminal tab
 * 5. Auto-connects if not already connected
 * 6. For Gemini: Sends the skill prompt after connection
 * 7. For Codex: Skill is injected via --full-context flag at spawn time
 */
export function useSkillRunner() {
  const { skills } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const {
    setActiveSkill,
    setCliProvider,
    setWorkingDirectory,
    connect,
    disconnect,
    status,
    cliProvider,
  } = usePtyTerminalStore();
  const { setActiveTab } = useMediaPanelStore();

  /**
   * Run a skill with the specified or current CLI provider.
   *
   * @param skillId - The ID of the skill to run
   * @param preferredProvider - Optional provider to use ("gemini" or "codex")
   *                           If not specified, uses the currently selected provider
   */
  const runSkill = useCallback(
    async (skillId: string, preferredProvider?: "gemini" | "codex") => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) {
        console.warn("[useSkillRunner] Skill not found:", skillId);
        return;
      }

      if (!activeProject) {
        console.warn("[useSkillRunner] No active project");
        return;
      }

      const providerToUse: CliProvider = preferredProvider || cliProvider;
      console.log("[useSkillRunner] Running skill:", skill.name, "with provider:", providerToUse);

      // 1. Get the project's skills folder path
      let skillsPath = "";
      try {
        if (window.electronAPI?.skills?.getPath) {
          skillsPath = await window.electronAPI.skills.getPath(activeProject.id);
          console.log("[useSkillRunner] Skills path:", skillsPath);
        }
      } catch (error) {
        console.error("[useSkillRunner] Failed to get skills path:", error);
      }

      // 2. Set skill as active context (used by both providers)
      setActiveSkill({
        id: skill.id,
        name: skill.name,
        content: skill.content,
      });

      // 3. Set provider if specified
      if (preferredProvider) {
        setCliProvider(preferredProvider);
      }

      // 4. Set working directory to project's skills folder
      if (skillsPath) {
        setWorkingDirectory(skillsPath);
      }

      // 5. Switch to PTY terminal tab
      setActiveTab("pty");

      // 6. If already connected, disconnect first to restart with new working directory/provider
      if (status === "connected") {
        console.log("[useSkillRunner] Disconnecting to restart with new configuration");
        await disconnect();
        // Small delay before reconnecting
        setTimeout(() => {
          connect();
        }, 200);
      } else if (status !== "connecting") {
        // Auto-start CLI if not connected
        console.log("[useSkillRunner] Auto-connecting to CLI:", providerToUse);
        await connect();
      }
    },
    [skills, activeProject, setActiveSkill, setCliProvider, setWorkingDirectory, setActiveTab, connect, disconnect, status, cliProvider]
  );

  return { runSkill };
}
