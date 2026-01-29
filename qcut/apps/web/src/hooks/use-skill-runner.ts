import { useCallback } from "react";
import { useSkillsStore } from "@/stores/skills-store";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";
import { useProjectStore } from "@/stores/project-store";

/**
 * Hook to run a skill with Gemini CLI
 *
 * When a skill is run:
 * 1. Sets the skill as active context in the PTY terminal store
 * 2. Enables Gemini CLI mode
 * 3. Sets the working directory to the project's skills folder
 * 4. Switches to the PTY terminal tab
 * 5. Auto-connects if not already connected
 * 6. Sends the skill prompt to Gemini CLI after connection
 */
export function useSkillRunner() {
  const { skills } = useSkillsStore();
  const { activeProject } = useProjectStore();
  const {
    setActiveSkill,
    setGeminiMode,
    setWorkingDirectory,
    connect,
    disconnect,
    status,
  } = usePtyTerminalStore();
  const { setActiveTab } = useMediaPanelStore();

  const runSkill = useCallback(
    async (skillId: string) => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) {
        console.warn("[useSkillRunner] Skill not found:", skillId);
        return;
      }

      if (!activeProject) {
        console.warn("[useSkillRunner] No active project");
        return;
      }

      console.log("[useSkillRunner] Running skill:", skill.name);

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

      // 2. Set skill as active context
      setActiveSkill({
        id: skill.id,
        name: skill.name,
        content: skill.content,
      });

      // 3. Ensure Gemini CLI mode is enabled
      setGeminiMode(true);

      // 4. Set working directory to project's skills folder
      if (skillsPath) {
        setWorkingDirectory(skillsPath);
      }

      // 5. Switch to PTY terminal tab
      setActiveTab("pty");

      // 6. If already connected, disconnect first to restart with new working directory
      if (status === "connected") {
        console.log("[useSkillRunner] Disconnecting to restart with new working directory");
        await disconnect();
        // Small delay before reconnecting
        setTimeout(() => {
          connect();
        }, 200);
      } else if (status !== "connecting") {
        // Auto-start Gemini CLI if not connected
        console.log("[useSkillRunner] Auto-connecting to Gemini CLI");
        await connect();
      }
    },
    [skills, activeProject, setActiveSkill, setGeminiMode, setWorkingDirectory, setActiveTab, connect, disconnect, status]
  );

  return { runSkill };
}
