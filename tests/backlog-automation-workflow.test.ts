import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readWorkflow(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function workflowSnippet(workflow: string, start: string, end: string): string {
  const startIndex = workflow.indexOf(start);
  const endIndex = workflow.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing workflow snippet starting with ${start}`);
  return workflow.slice(startIndex, endIndex);
}

describe("backlog automation stale-work-item check", () => {
  it("normalizes quoted completed statuses before treating an item as stale", () => {
    const workflow = readWorkflow(".github/workflows/backlog-automation.yml");
    const normalizeStatus = workflowSnippet(workflow, '            status="${status#', "\n\n            file_base=");

    for (const status of ['"completed"', "'completed'", "  completed  "]) {
      const result = execFileSync("bash", ["-c", `${normalizeStatus}\nprintf '%s' "$status"`], {
        encoding: "utf8",
        env: { ...process.env, status },
      });
      expect(result).toBe("completed");
    }
  });

  it("ignores body and evidence PR URLs while detecting links.pull_requests", () => {
    const workflow = readWorkflow(".github/workflows/backlog-automation.yml");
    const match = /awk '\n(?<script>\s+\/\^\[\[:space:\]\]\*links:[\s\S]*?)\n\s+' <<<"\$frontmatter"/.exec(workflow);
    expect(match?.groups?.script).toBeDefined();
    const workItem = `---
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/101
  evidence:
    - https://github.com/calan-co/doc-vader/pull/102
---
Evidence references https://github.com/calan-co/doc-vader/pull/103.
`;
    const frontmatter = workItem.split("---")[1];
    const linkedEntries = execFileSync("awk", [match!.groups!.script!], {
      encoding: "utf8",
      input: frontmatter,
    });

    expect(linkedEntries).toContain("https://github.com/calan-co/doc-vader/pull/101");
    expect(linkedEntries).not.toContain("https://github.com/calan-co/doc-vader/pull/102");
    expect(linkedEntries).not.toContain("https://github.com/calan-co/doc-vader/pull/103");
  });

  it("detects flow-style pull request links", () => {
    const workflow = readWorkflow(".github/workflows/backlog-automation.yml");
    const match = /awk '\n(?<script>\s+\/\^\[\[:space:\]\]\*links:[\s\S]*?)\n\s+' <<<"\$frontmatter"/.exec(workflow);
    const linkedEntries = execFileSync("awk", [match!.groups!.script!], {
      encoding: "utf8",
      input: "\nlinks:\n  pull_requests: [\"https://github.com/calan-co/doc-vader/pull/104\"]\n",
    });

    expect(linkedEntries).toContain("https://github.com/calan-co/doc-vader/pull/104");
  });

  it("detects multiline flow-style pull request links", () => {
    const workflow = readWorkflow(".github/workflows/backlog-automation.yml");
    const match = /awk '\n(?<script>\s+\/\^\[\[:space:\]\]\*links:[\s\S]*?)\n\s+' <<<"\$frontmatter"/.exec(workflow);
    const linkedEntries = execFileSync("awk", [match!.groups!.script!], {
      encoding: "utf8",
      input: `
links:
  pull_requests: [
    "https://github.com/calan-co/doc-vader/pull/105",
    "https://github.com/calan-co/doc-vader/pull/106"
  ]
`,
    });

    expect(linkedEntries).toContain("https://github.com/calan-co/doc-vader/pull/105");
    expect(linkedEntries).toContain("https://github.com/calan-co/doc-vader/pull/106");
  });
});
