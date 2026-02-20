import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn(async () => {}),
  mockWriteFile: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

import { resolve } from "node:path";
import { generatePipelineReport } from "../claude/claude-summary-handler";
import {
  logOperation,
  getOperationLog,
  clearOperationLog,
} from "../claude/claude-operation-log";

const summary = {
  markdown: "## Project: My Video\n",
  stats: {
    totalDuration: 125,
    trackCount: 2,
    elementCount: 15,
    mediaFileCount: 8,
    exportCount: 1,
    totalSourceDuration: 330,
  },
};

const steps = [
  {
    stage: 1,
    action: "import",
    details: "Imported 3 videos from URLs",
    timestamp: 1,
    duration: 12.5,
    projectId: "proj_1",
  },
  {
    stage: 2,
    action: "transcribe",
    details: "Transcribed 5 clips",
    timestamp: 2,
    duration: 45.2,
    projectId: "proj_1",
  },
  {
    stage: 3,
    action: "cut",
    details: "Removed 15 filler words",
    timestamp: 3,
    duration: 8.5,
    projectId: "proj_1",
  },
  {
    stage: 4,
    action: "arrange",
    details: "Arranged clips sequentially",
    timestamp: 4,
    projectId: "proj_1",
  },
  {
    stage: 5,
    action: "export",
    details: "Exported as YouTube 1080p",
    timestamp: 5,
    duration: 52,
    projectId: "proj_1",
  },
];

describe("generatePipelineReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOperationLog();
  });

  it("generates report from operation log", async () => {
    const report = await generatePipelineReport({
      steps,
      summary,
      projectId: "proj_1",
    });

    expect(report.markdown).toContain("## Auto-Edit Pipeline Report");
    expect(report.markdown).toContain("Imported 3 videos from URLs");
    expect(report.markdown).toContain("Exported as YouTube 1080p");
  });

  it("includes all 5 stages", async () => {
    const report = await generatePipelineReport({
      steps,
      summary,
      projectId: "proj_1",
    });

    expect(report.markdown).toContain("### Stage 1: Import");
    expect(report.markdown).toContain("### Stage 2: Understanding");
    expect(report.markdown).toContain("### Stage 3: Editing");
    expect(report.markdown).toContain("### Stage 4: Organization");
    expect(report.markdown).toContain("### Stage 5: Export");
  });

  it("calculates correct time savings", async () => {
    const report = await generatePipelineReport({
      steps,
      summary,
      projectId: "proj_1",
    });

    expect(report.markdown).toContain("Original footage: 5:30");
    expect(report.markdown).toContain("Final duration: 2:05");
    expect(report.markdown).toContain("Time saved: 3:25");
  });

  it("saves report to disk when requested", async () => {
    const report = await generatePipelineReport({
      steps,
      summary,
      projectId: "proj_1",
      saveToDisk: true,
      outputDir: "/tmp/reports",
    });

    expect(mockMkdir).toHaveBeenCalledWith(resolve("/tmp/reports"), { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(report.savedTo).toContain("pipeline-report-proj_1-");
  });

  it("handles empty operation log", async () => {
    const report = await generatePipelineReport({
      steps: [],
      summary,
      projectId: "proj_1",
    });

    expect(report.markdown).toContain("No recorded pipeline operations");
  });

  it("supports clearing operation log after report generation", async () => {
    logOperation({
      stage: 1,
      action: "import",
      details: "Imported 1 file",
      timestamp: Date.now(),
      projectId: "proj_1",
    });

    expect(getOperationLog({ projectId: "proj_1" }).length).toBe(1);

    clearOperationLog({ projectId: "proj_1" });

    expect(getOperationLog({ projectId: "proj_1" }).length).toBe(0);
  });
});
