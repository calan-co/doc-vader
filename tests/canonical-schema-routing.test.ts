import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

describe("canonical schema routing surfaces", () => {
  it("routes work items through work-management schemas", () => {
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

    expect(
      existsSync(path.join(repoRoot, "schemas/frontmatter/by-type/work-item")),
    ).toBe(false);
    expect(
      existsSync(path.join(repoRoot, "schemas/frontmatter/work-item")),
    ).toBe(false);

    const template = readFileSync(templatePath, "utf8");
    expect(template).toContain(
      "../../schemas/frontmatter/by-type/document/latest.json",
    );
    expect(template).toContain(
      "../../schemas/work-management/frontmatter/work-item.json",
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
    ).toBe("schemas/work-management/frontmatter/work-item.json");

    const schemaMap = JSON.parse(
      readFileSync(path.join(repoRoot, "schemas/frontmatter/schema-map.json"), "utf8"),
    ) as { default?: string; byType?: Record<string, string> };
    const schemaReadme = readFileSync(schemaReadmePath, "utf8");
    expect(schemaMap.default).toBeUndefined();
    expect(schemaReadme).not.toContain('"default":');
    expect(schemaReadme).toContain(
      `"document":  "${schemaMap.byType?.document}"`,
    );
    expect(schemaReadme).toContain(
      `"work-item": "${schemaMap.byType?.["work-item"]}"`,
    );

    const backlogOverview = readFileSync(backlogOverviewPath, "utf8");
    expect(backlogOverview).toContain(
      '"changed": "schemas/work-management/frontmatter/work-item.json"',
    );

    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toContain(
      '"changed": "schemas/work-management/frontmatter/work-item.json"',
    );

    const templateGenerator = readFileSync(templateGeneratorPath, "utf8");
    expect(templateGenerator).toContain(
      "schemas/frontmatter/by-type/document/latest.json",
    );
    expect(templateGenerator).toContain(
      "schemas/work-management/frontmatter/work-item.json",
    );

    const docStatusLint = readFileSync(docStatusLintPath, "utf8");
    expect(docStatusLint).toContain(
      "schemas/frontmatter/by-type/document/latest.json",
    );
  });
});
