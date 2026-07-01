import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const repoRoot = path.resolve(__dirname, "..");
const CLI_TEST_TIMEOUT_MS = 15_000;
const runCli = (args = "") => {
  try {
    return execFileSync(
      process.execPath,
      ["--import", "tsx", cliPath, ...args.split(/\s+/).filter(Boolean)],
      {
        encoding: "utf-8",
        cwd: repoRoot,
        env: { ...process.env, TMPDIR: process.env.TMPDIR ?? "/tmp" },
      },
    );
  } catch (err) {
    if (typeof err === "object" && err !== null) {
      // execSync throws a child_process.ExecSyncError which has stdout
      // but may not be typed as such
      // @ts-ignore
      return err.stdout ? String(err.stdout) : String((err as Error).message);
    }
    return String(err);
  }
};

describe("doc-vader CLI integration", () => {
  it("should show help with no args", { timeout: 15000 }, () => {
    const output = runCli();
    expect(output).toMatch(/Doc-Vader CLI/);
    expect(output).toMatch(/validate/);
  });

  it("should run validate command", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
    const output = runCli("validate");
    expect(output).toMatch(
      /(error|success|validated|invalid|valid|No moves necessary)/i,
    );
  });

  it("should run doc-system diataxis-validate command", () => {
    const output = runCli(
      `doc-system diataxis-validate --file ${path.join(repoRoot, "docs/how-to/getting-started.md")} --diataxis how-to`,
    );
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("should run doc-system diataxis-fix command", () => {
    const output = runCli("doc-system diataxis-fix docs --dry-run");
    expect(output).toMatch(/(fix|error|success|diataxis|No moves necessary)/i);
  });

  it("should run frontmatter utils command", () => {
    const output = runCli(
      `frontmatter utils --input ${path.join(repoRoot, "backlog/60390-record-edges-and-audit-lineage.md")}`,
    );
    expect(output.trim()).toBe("{}");
  });

  it("should run doc-system validate command", () => {
    const output = runCli(
      `doc-system validate --docs-dir ${path.join(repoRoot, "docs")} --schema-dir ${path.join(repoRoot, "schemas")}`,
    );
    expect(output).toMatch(
      /(validate|error|success|structure|content|No moves necessary)/i,
    );
  });

  it("should run frontmatter validate command", () => {
    const output = runCli(
      `frontmatter validate ${path.join(repoRoot, "docs")} --no-strict`,
    );
    expect(output).toMatch(
      /(frontmatter|error|success|validate|No moves necessary)/i,
    );
  });

  it("should run backlog command", () => {
    const output = runCli("backlog list");
    expect(output).toMatch(/(backlog|error|success|list)/i);
  });

  it("should run backlog scan with fixtures in json mode", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
    const output = runCli(
      `backlog scan --dir ${path.join(repoRoot, "tests/fixtures/backlog-scan")} --report-format json`,
    );
    const parsed = JSON.parse(output);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(output).toMatch(/25519076107/);
    const item = parsed.items.find((entry: { file: string }) =>
      entry.file.includes("templjs-workflow-run-25519076107.md"),
    );
    expect(item).toBeTruthy();
    expect(item.eventMetadata?.id).toBe("work-item:175");
    const conditionCodes = item.conditions.map(
      (condition: { code: string }) => condition.code,
    );
    expect(conditionCodes).toContain("pr_link_found");
    expect(conditionCodes).toContain("pr_merged");
    expect(conditionCodes).toContain("workflow_succeeded");
    expect(conditionCodes).toContain("valid_status");
  });
});
