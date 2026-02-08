import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseReleaseNote,
  compareSemver,
  parseChangelog,
  readReleaseNotesFromDir,
} from "../release-notes-utils";

// ============================================================================
// parseReleaseNote
// ============================================================================

describe("parseReleaseNote", () => {
  it("should parse valid frontmatter with all fields", () => {
    const raw = `---
version: "0.3.52"
date: "2025-01-31"
channel: "stable"
---

# QCut v0.3.52

## What's New
- Skills system`;

    const result = parseReleaseNote(raw);
    expect(result).not.toBeNull();
    expect(result?.version).toBe("0.3.52");
    expect(result?.date).toBe("2025-01-31");
    expect(result?.channel).toBe("stable");
    expect(result?.content).toContain("What's New");
    expect(result?.content).toContain("Skills system");
  });

  it("should parse frontmatter without quotes", () => {
    const raw = `---
version: 1.0.0
date: 2026-01-01
channel: stable
---

Content here`;

    const result = parseReleaseNote(raw);
    expect(result).not.toBeNull();
    expect(result?.version).toBe("1.0.0");
    expect(result?.date).toBe("2026-01-01");
    expect(result?.channel).toBe("stable");
  });

  it("should handle prerelease channel", () => {
    const raw = `---
version: "0.3.53-alpha.1"
date: "2026-02-05"
channel: "alpha"
---

Alpha content`;

    const result = parseReleaseNote(raw);
    expect(result?.version).toBe("0.3.53-alpha.1");
    expect(result?.channel).toBe("alpha");
  });

  it("should return null for missing frontmatter", () => {
    const raw = "# Just a heading\n\nNo frontmatter here.";
    expect(parseReleaseNote(raw)).toBeNull();
  });

  it("should return null for missing version field", () => {
    const raw = `---
date: "2025-01-01"
channel: "stable"
---

No version field`;

    expect(parseReleaseNote(raw)).toBeNull();
  });

  it("should default channel to stable if missing", () => {
    const raw = `---
version: "1.0.0"
date: "2025-01-01"
---

Content`;

    const result = parseReleaseNote(raw);
    expect(result?.channel).toBe("stable");
  });

  it("should default date to empty string if missing", () => {
    const raw = `---
version: "1.0.0"
---

Content`;

    const result = parseReleaseNote(raw);
    expect(result?.date).toBe("");
  });

  it("should handle Windows-style line endings (CRLF)", () => {
    const raw =
      '---\r\nversion: "1.0.0"\r\ndate: "2025-01-01"\r\nchannel: "stable"\r\n---\r\n\r\nContent with CRLF';

    const result = parseReleaseNote(raw);
    expect(result).not.toBeNull();
    expect(result?.version).toBe("1.0.0");
    expect(result?.content).toBe("Content with CRLF");
  });

  it("should trim content whitespace", () => {
    const raw = `---
version: "1.0.0"
---

  Content with spaces

`;

    const result = parseReleaseNote(raw);
    expect(result?.content).toBe("Content with spaces");
  });

  it("should return null for empty string", () => {
    expect(parseReleaseNote("")).toBeNull();
  });

  it("should return null for incomplete frontmatter delimiters", () => {
    const raw = `---
version: "1.0.0"

Missing closing delimiter`;

    expect(parseReleaseNote(raw)).toBeNull();
  });
});

// ============================================================================
// compareSemver
// ============================================================================

describe("compareSemver", () => {
  it("should return 0 for equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("should compare major versions", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("should compare minor versions", () => {
    expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
    expect(compareSemver("1.1.0", "1.2.0")).toBeLessThan(0);
  });

  it("should compare patch versions", () => {
    expect(compareSemver("1.0.2", "1.0.1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.1", "1.0.2")).toBeLessThan(0);
  });

  it("should rank stable higher than prerelease", () => {
    expect(compareSemver("1.0.0", "1.0.0-alpha.1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0")).toBeLessThan(0);
  });

  it("should compare prerelease channels alphabetically", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0-alpha.1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-beta.1")).toBeLessThan(0);
  });

  it("should compare rc higher than beta", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  it("should return 0 for equal prerelease versions", () => {
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.1")).toBe(0);
  });

  it("should handle version with higher base trumping prerelease", () => {
    // 1.0.1-alpha.1 > 1.0.0 because base version is higher
    expect(compareSemver("1.0.1-alpha.1", "1.0.0")).toBeGreaterThan(0);
  });
});

// ============================================================================
// parseChangelog
// ============================================================================

describe("parseChangelog", () => {
  it("should parse a standard CHANGELOG.md with multiple versions", () => {
    const raw = `# Changelog

## [Unreleased]

### Added
- Something new

## [0.3.52] - 2025-01-31

### Added
- Skills system

### Fixed
- Various bug fixes

## [0.3.0] - 2025-01-15

### Added
- Electron desktop application
`;

    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].version).toBe("0.3.52");
    expect(entries[0].date).toBe("2025-01-31");
    expect(entries[0].channel).toBe("stable");
    expect(entries[0].content).toContain("Skills system");
    expect(entries[1].version).toBe("0.3.0");
    expect(entries[1].date).toBe("2025-01-15");
  });

  it("should detect prerelease channel from version string", () => {
    const raw = `## [0.3.53-alpha.1] - 2026-02-05

### Added
- Alpha feature
`;

    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].channel).toBe("alpha");
  });

  it("should handle versions without dates", () => {
    const raw = `## [1.0.0]

### Added
- First stable release
`;

    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe("");
  });

  it("should return empty array for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  it("should return empty array if no version headers found", () => {
    const raw = `# Changelog

Just some text with no version headers.
`;

    expect(parseChangelog(raw)).toEqual([]);
  });

  it("should prefix content with QCut version heading", () => {
    const raw = `## [1.0.0] - 2025-01-01

### Added
- Feature A
`;

    const entries = parseChangelog(raw);
    expect(entries[0].content).toMatch(/^# QCut v1\.0\.0/);
  });
});

// ============================================================================
// readReleaseNotesFromDir
// ============================================================================

describe("readReleaseNotesFromDir", () => {
  const testDir = path.join(__dirname, "test-releases");

  beforeEach(() => {
    // Create a temporary test directory with release files
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(testDir, "v0.1.0.md"),
      `---
version: "0.1.0"
date: "2024-12-15"
channel: "stable"
---

# QCut v0.1.0

## What's New
- Initial release`
    );

    fs.writeFileSync(
      path.join(testDir, "v0.3.52.md"),
      `---
version: "0.3.52"
date: "2025-01-31"
channel: "stable"
---

# QCut v0.3.52

## What's New
- Skills system`
    );

    fs.writeFileSync(
      path.join(testDir, "v0.3.53-alpha.1.md"),
      `---
version: "0.3.53-alpha.1"
date: "2026-02-05"
channel: "alpha"
---

# QCut v0.3.53-alpha.1

## What's New
- Alpha feature`
    );

    // Non-version file that should be ignored
    fs.writeFileSync(path.join(testDir, "README.md"), "# This is the README");
    fs.writeFileSync(
      path.join(testDir, "latest.md"),
      `---
version: "0.3.52"
date: "2025-01-31"
channel: "stable"
---

Latest content`
    );
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      for (const file of fs.readdirSync(testDir)) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  it("should read and parse all version files", () => {
    const notes = readReleaseNotesFromDir(testDir);
    expect(notes).toHaveLength(3);
  });

  it("should sort results newest first", () => {
    const notes = readReleaseNotesFromDir(testDir);
    expect(notes[0].version).toBe("0.3.53-alpha.1");
    expect(notes[1].version).toBe("0.3.52");
    expect(notes[2].version).toBe("0.1.0");
  });

  it("should ignore non-version files like README.md and latest.md", () => {
    const notes = readReleaseNotesFromDir(testDir);
    const versions = notes.map((n) => n.version);
    expect(versions).not.toContain("README");
    // latest.md doesn't start with "v" so it's excluded
    expect(notes).toHaveLength(3);
  });

  it("should return empty array for non-existent directory", () => {
    const notes = readReleaseNotesFromDir("/non/existent/path");
    expect(notes).toEqual([]);
  });

  it("should skip files with invalid frontmatter", () => {
    fs.writeFileSync(
      path.join(testDir, "v99.0.0.md"),
      "No frontmatter in this file"
    );

    const notes = readReleaseNotesFromDir(testDir);
    const versions = notes.map((n) => n.version);
    expect(versions).not.toContain("99.0.0");
  });
});
