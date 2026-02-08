/**
 * Release notes parsing and version comparison utilities.
 * Pure functions extracted from main.ts for testability.
 *
 * @module electron/release-notes-utils
 */

import * as fs from "fs";

/**
 * Parse a release note Markdown file with YAML frontmatter.
 * Returns { version, date, channel, content } or null on failure.
 */
export function parseReleaseNote(raw: string): {
  version: string;
  date: string;
  channel: string;
  content: string;
} | null {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return null;
  }

  const frontmatter = fmMatch[1];
  const content = fmMatch[2].trim();

  const versionMatch = frontmatter.match(/^version:\s*"?([^"\n]+)"?/m);
  const dateMatch = frontmatter.match(/^date:\s*"?([^"\n]+)"?/m);
  const channelMatch = frontmatter.match(/^channel:\s*"?([^"\n]+)"?/m);

  if (!versionMatch) {
    return null;
  }

  return {
    version: versionMatch[1].trim(),
    date: dateMatch ? dateMatch[1].trim() : "",
    channel: channelMatch ? channelMatch[1].trim() : "stable",
    content,
  };
}

/**
 * Compare two semver strings. Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parseV = (v: string) => {
    const [main, pre] = v.split("-");
    const parts = main.split(".").map(Number);
    return { parts, pre: pre || "" };
  };

  const pA = parseV(a);
  const pB = parseV(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pA.parts[i] || 0) - (pB.parts[i] || 0);
    if (diff !== 0) return diff;
  }

  // No prerelease > prerelease (stable is higher)
  if (!pA.pre && pB.pre) return 1;
  if (pA.pre && !pB.pre) return -1;
  if (pA.pre && pB.pre) {
    const [labelA, numA] = pA.pre.split(".");
    const [labelB, numB] = pB.pre.split(".");
    if (labelA !== labelB) return labelA.localeCompare(labelB);
    return (Number(numA) || 0) - (Number(numB) || 0);
  }
  return 0;
}

/**
 * Parse a CHANGELOG.md file into release note entries.
 * Each entry in the changelog with `## [x.y.z] - YYYY-MM-DD` format is extracted.
 */
export function parseChangelog(raw: string): Array<{
  version: string;
  date: string;
  channel: string;
  content: string;
}> {
  const entries: Array<{
    version: string;
    date: string;
    channel: string;
    content: string;
  }> = [];

  const versionRegex =
    /^## \[(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)\](?: - (\d{4}-\d{2}-\d{2}))?/gm;
  const positions: Array<{
    version: string;
    date: string;
    start: number;
    headerStart: number;
  }> = [];

  for (
    let match = versionRegex.exec(raw);
    match !== null;
    match = versionRegex.exec(raw)
  ) {
    positions.push({
      version: match[1],
      date: match[2] || "",
      start: match.index + match[0].length,
      headerStart: match.index,
    });
  }

  for (let i = 0; i < positions.length; i++) {
    const end =
      i + 1 < positions.length ? positions[i + 1].headerStart : raw.length;
    const content = raw.slice(positions[i].start, end).trim();
    const version = positions[i].version;

    entries.push({
      version,
      date: positions[i].date,
      channel: version.includes("-")
        ? version.split("-")[1].split(".")[0]
        : "stable",
      content: `# QCut v${version}\n\n${content}`,
    });
  }

  return entries;
}

/**
 * Read and parse all release note files from a directory.
 * Returns sorted (newest first) release notes.
 */
export function readReleaseNotesFromDir(releasesDir: string): Array<{
  version: string;
  date: string;
  channel: string;
  content: string;
}> {
  if (!fs.existsSync(releasesDir)) {
    return [];
  }

  const files = fs
    .readdirSync(releasesDir)
    .filter((f: string) => f.startsWith("v") && f.endsWith(".md"))
    .sort((a: string, b: string) => {
      const vA = a.replace(/^v/, "").replace(/\.md$/, "");
      const vB = b.replace(/^v/, "").replace(/\.md$/, "");
      return compareSemver(vB, vA);
    });

  const notes: Array<{
    version: string;
    date: string;
    channel: string;
    content: string;
  }> = [];

  for (const file of files) {
    const raw = fs.readFileSync(`${releasesDir}/${file}`, "utf-8");
    const parsed = parseReleaseNote(raw);
    if (parsed) {
      notes.push(parsed);
    }
  }

  return notes;
}
