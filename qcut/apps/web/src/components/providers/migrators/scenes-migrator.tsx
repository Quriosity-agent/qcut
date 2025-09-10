"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { storageService } from "@/lib/storage/storage-service";
import { TProject, Scene } from "@/types/project";
import { generateUUID } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { createMainScene } from "@/stores/project-store";

interface MigrationProgress {
  current: number;
  total: number;
  currentProjectName: string;
}

export function ScenesMigrator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress>({
    current: 0,
    total: 0,
    currentProjectName: "",
  });

  const shouldCheckMigration =
    pathname?.startsWith("/editor") || pathname?.startsWith("/projects");

  const migrateLegacyProject = useCallback(async (project: TProject) => {
    try {
      // Create main scene via helper (consistent defaults)
      const mainScene = createMainScene();

      const migratedProject: TProject = {
        ...project,
        scenes: [mainScene],
        currentSceneId: mainScene.id,
        updatedAt: new Date(),
        // Add default canvas size if not present
        canvasSize: project.canvasSize ?? { width: 1920, height: 1080 },
        canvasMode: project.canvasMode ?? "preset",
      };

      // 1) Load legacy timeline data (legacy format)
      const legacyTimeline = await storageService.loadTimeline({
        projectId: project.id,
      });

      // 2) Migrate timeline first so operation is idempotent/restartable
      if (legacyTimeline?.length) {
        await storageService.saveTimeline({
          projectId: project.id,
          tracks: legacyTimeline,
          sceneId: mainScene.id,
        });
      }

      // 3) Persist the migrated project shape
      await storageService.saveProject({ project: migratedProject });

      // 4) Clean up legacy timeline storage
      await storageService.deleteProjectTimeline({ projectId: project.id });
    } catch (error) {
      console.error(`Failed to migrate project ${project.name}:`, error);
      throw error;
    }
  }, []);

  const checkAndMigrateProjects = useCallback(async () => {
    if (!shouldCheckMigration) return;

    try {
      const projects = await storageService.loadAllProjects();
      const legacyProjects: TProject[] = [];
      for (const project of projects) {
        const hasScenes =
          Array.isArray(project.scenes) &&
          project.scenes.length > 0 &&
          !!project.currentSceneId;
        const legacyTimeline = await storageService.loadTimeline({
          projectId: project.id,
        });
        const needsTimelineMigration = !!legacyTimeline?.length;
        if (!hasScenes || needsTimelineMigration) {
          legacyProjects.push(project);
        }
      }

      if (legacyProjects.length === 0) {
        // No migration needed
        return;
      }

      setIsMigrating(true);
      setProgress({
        current: 0,
        total: legacyProjects.length,
        currentProjectName: "",
      });

      // Migrate each legacy project
      for (let i = 0; i < legacyProjects.length; i++) {
        const project = legacyProjects[i];
        // Show progress for the current item
        setProgress({
          current: i,
          total: legacyProjects.length,
          currentProjectName: project.name,
        });
        await migrateLegacyProject(project);
      }

      setProgress({
        current: legacyProjects.length,
        total: legacyProjects.length,
        currentProjectName: "Complete!",
      });

      setTimeout(() => {
        setIsMigrating(false);
      }, 1000);
    } catch (error) {
      console.error("Migration failed:", error);
      setIsMigrating(false);
    }
  }, [shouldCheckMigration, migrateLegacyProject]);

  useEffect(() => {
    checkAndMigrateProjects();
  }, [checkAndMigrateProjects]);

  if (!shouldCheckMigration) {
    return children;
  }

  if (isMigrating) {
    const progressPercent =
      progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

    return (
      <Dialog open={true}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Updating Projects</DialogTitle>
            <DialogDescription>
              We're adding scene support to your projects. This will only take a
              moment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>
                  {progress.current} of {progress.total}
                </span>
              </div>
              <Progress value={progressPercent} className="w-full" />
            </div>

            {progress.currentProjectName && (
              <div className="text-sm text-muted-foreground">
                {progress.current < progress.total
                  ? `Updating: ${progress.currentProjectName}`
                  : progress.currentProjectName}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return children;
}
