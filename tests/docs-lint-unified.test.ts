import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const SCRIPT_PATH = path.resolve(
  __dirname,
  "../staging/scripts/docs-lint.sh",
);

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("docs-lint unified pipeline", () => {
  it(
    "reports frontmatter schema failures through remark without the legacy validator",
    { timeout: 30000 },
    async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "docs-lint-unified-"),
    );
    tempDirs.push(root);

    const docsDir = path.join(root, "docs");
    const schemaRoot = path.join(root, "schemas", "frontmatter");
    const schemaDir = path.join(schemaRoot, "by-type", "testdoc");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(schemaDir, { recursive: true });

    await fs.writeFile(
      path.join(schemaDir, "latest.json"),
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            type: { type: "string", const: "testdoc" },
            title: { type: "string" },
          },
          required: ["type", "title"],
          additionalProperties: true,
        },
        null,
        2,
      ),
      "utf8",
    );

    const docPath = path.join(docsDir, "broken.md");
    await fs.writeFile(
      docPath,
      "---\ntype: testdoc\n---\n\n# Broken\n",
      "utf8",
    );

    let output = "";
    let failed = false;
    try {
      output = execSync(
        `bash ${JSON.stringify(SCRIPT_PATH)} --fail-on error ${JSON.stringify(
          path.join(docsDir, "**/*.md"),
        )}`,
        {
          cwd: path.resolve(__dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            DOCS_SCHEMA_DIR: schemaRoot,
          },
        },
      );
    } catch (err) {
      failed = true;
      if (typeof err === "object" && err !== null && "stdout" in err) {
        output = String((err as { stdout?: unknown }).stdout ?? "");
      } else {
        throw err;
      }
    }

    expect(failed).toBe(true);
    expect(output).toContain("[frontmatter-schema]");
    expect(output).not.toContain("Validating frontmatter schema...");
    expect(output).not.toContain("Frontmatter validation failed");
    },
  );
});
