import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";

const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const runCli = (args = "") => {
  try {
    return execSync(`pnpm exec tsx ${cliPath} ${args}`, { encoding: "utf-8" });
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
  it("should show help with no args", () => {
    const output = runCli();
    expect(output).toMatch(/Doc-Vader CLI/);
    expect(output).toMatch(/validate/);
  });

  it("should run validate command", () => {
    const output = runCli("validate");
    expect(output).toMatch(
      /(error|success|validated|invalid|valid|No moves necessary)/i
    );
  });

  it("should run docs-diataxis command", () => {
    const output = runCli("docs-diataxis");
    expect(output).toMatch(
      /(analyze|error|success|diataxis|No moves necessary)/i
    );
  });

  it("should run fix-docs-diataxis command", () => {
    const output = runCli("fix-docs-diataxis");
    expect(output).toMatch(/(fix|error|success|diataxis|No moves necessary)/i);
  });

  it("should run frontmatter-utils command", () => {
    const output = runCli("frontmatter-utils");
    expect(output).toMatch(/(frontmatter|error|success|parse|format)/i);
  });

  it("should run validate-docs command", () => {
    const output = runCli("validate-docs");
    expect(output).toMatch(
      /(validate|error|success|structure|content|No moves necessary)/i
    );
  });

  it("should run validate-frontmatter command", () => {
    const output = runCli("validate-frontmatter");
    expect(output).toMatch(
      /(frontmatter|error|success|validate|No moves necessary)/i
    );
  });

  it("should run backlog command", () => {
    const output = runCli("backlog --list");
    expect(output).toMatch(/(backlog|error|success|list)/i);
  });

  it("should run backlog scan with fixtures in json mode", () => {
    const output = runCli(
      "backlog scan --dir tests/fixtures/backlog-scan --report-format json"
    );
    const parsed = JSON.parse(output);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(output).toMatch(/25519076107/);
    const item = parsed.items.find((entry: { file: string }) =>
      entry.file.includes("templjs-workflow-run-25519076107.md")
    );
    expect(item).toBeTruthy();
    expect(item.eventMetadata?.id).toBe("work-item:175");
    const conditionCodes = item.conditions.map(
      (condition: { code: string }) => condition.code
    );
    expect(conditionCodes).toContain("pr_link_found");
    expect(conditionCodes).toContain("pr_merged");
    expect(conditionCodes).toContain("workflow_succeeded");
    expect(conditionCodes).toContain("valid_status");
  });
});
