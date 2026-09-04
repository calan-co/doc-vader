import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { auditBacklog } from "../lib/backlog/audit.js";

const repoRoot = path.resolve(__dirname, "..");

describe("canonical schema routing surfaces", () => {
  it("keeps the backlog template and consumer profile on by-type/latest paths", () => {
    const templatePath = path.join(
      repoRoot,
      "templates/reference/backlog/precommit-validation-rules.tpl.md",
    );
    const consumerConfigPath = path.join(
      repoRoot,
      ".doc-vader/backlog-consumer.json",
    );
    const schemaReadmePath = path.join(repoRoot, "schemas/README.md");
    const backlogOverviewPath = path.join(
      repoRoot,
      "docs/reference/work-management/overview.md",
    );
    const readmePath = path.join(repoRoot, "README.md");
    const templateGeneratorPath = path.join(
      repoRoot,
      "staging/archived/scripts/generate-templates-from-schema.js",
    );
    const docStatusLintPath = path.join(
      repoRoot,
      "staging/archived/scripts/lint/doc-status-transition-lint.cjs",
    );

    const template = readFileSync(templatePath, "utf8");
    expect(template).toContain(
      "../../schemas/frontmatter/by-type/document/latest.json",
    );
    expect(template).toContain(
      "../../schemas/frontmatter/by-type/work-item/latest.json",
    );

    const consumerConfig = JSON.parse(readFileSync(consumerConfigPath, "utf8")) as {
      automation?: {
        prePushValidation?: {
          schemas?: {
            changed?: string;
          };
        };
      };
    };

    expect(
      consumerConfig.automation?.prePushValidation?.schemas?.changed,
    ).toBe("schemas/frontmatter/by-type/work-item/latest.json");

    const schemaReadme = readFileSync(schemaReadmePath, "utf8");
    expect(schemaReadme).toContain(
      '"default": "schemas/frontmatter/by-type/document/latest.json"',
    );
    expect(schemaReadme).toContain(
      '"document":  "schemas/frontmatter/by-type/document/latest.json"',
    );
    expect(schemaReadme).toContain(
      '"work-item": "schemas/frontmatter/by-type/work-item/latest.json"',
    );

    const backlogOverview = readFileSync(backlogOverviewPath, "utf8");
    expect(backlogOverview).toContain(
      '"changed": "schemas/frontmatter/by-type/work-item/latest.json"',
    );

    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toContain(
      '"changed": "schemas/frontmatter/by-type/work-item/latest.json"',
    );

    const templateGenerator = readFileSync(templateGeneratorPath, "utf8");
    expect(templateGenerator).toContain(
      "schemas/frontmatter/by-type/document/latest.json",
    );
    expect(templateGenerator).toContain(
      "schemas/frontmatter/by-type/work-item/latest.json",
    );

    const docStatusLint = readFileSync(docStatusLintPath, "utf8");
    expect(docStatusLint).toContain(
      "schemas/frontmatter/by-type/document/latest.json",
    );
  });

  it("validates the normalized archived Work relationship under strict routing", async () => {
    const report = await auditBacklog({
      rootDir: repoRoot,
      backlogDir: path.join(repoRoot, "backlog"),
      includeArchive: true,
      format: "json",
    });
    expect(report.schema_violations.filter(({ file }) =>
      file === "backlog/archive/228.design-cross-file-registry-model-story.md",
    )).toEqual([]);
  });

  it("keeps legacy lint routing estimate-optional while canonical terminal policy owns actual", () => {
    for (const version of ["current.json", "latest.json", "1.0.0.json"]) {
      const schema = JSON.parse(readFileSync(
        path.join(repoRoot, "schemas/frontmatter/by-type/work-item", version),
        "utf8",
      )) as { allOf: Array<{ required?: string[] }> };
      const workItemFields = schema.allOf.find((entry) => entry.required?.includes("priority"));
      expect(workItemFields?.required).not.toContain("estimated");
    }

    const statusPolicy = JSON.parse(readFileSync(
      path.join(repoRoot, "schemas/work-management/workflows/default/status-policy.json"),
      "utf8",
    )) as { allOf: Array<{ then?: { allOf?: Array<{ if?: { required?: string[] }; then?: { required?: string[] } }> } }> };
    const terminalPolicy = statusPolicy.allOf.find((entry) => entry.then?.allOf);
    expect(terminalPolicy?.then?.allOf).toContainEqual({
      if: {
        anyOf: [
          { required: ["estimated"] },
          { not: { properties: { tags: { type: "array", contains: { const: "afk" } } }, required: ["tags"] } },
        ],
      },
      then: { required: ["actual"] },
    });
  });
});
