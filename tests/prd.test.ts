import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import {
  renderPrd,
  validatePrdPayload,
} from "../lib/prd/index.js";

const rootDir = path.resolve(__dirname, "..");

async function writeExamplePayload(): Promise<string> {
  const schemaPath = path.join(rootDir, "schemas/work-management/content/prd.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    examples?: unknown[];
  };
  if (!Array.isArray(schema.examples) || schema.examples.length === 0) {
    throw new Error(`No examples found in schema: ${schemaPath}`);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "doc-vader-prd-"));
  const payloadPath = path.join(dir, "sample.content.json");
  await writeFile(payloadPath, `${JSON.stringify(schema.examples[0], null, 2)}\n`, "utf8");
  return payloadPath;
}

describe("PRD lifecycle", () => {
  it("validates the content schema example payload", async () => {
    const payloadPath = await writeExamplePayload();

    const result = await validatePrdPayload({
      rootDir,
      payloadPath,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("renders Markdown and preserves the JSON payload sidecar", async () => {
    const payloadPath = await writeExamplePayload();
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "doc-vader-prd-render-"));
    const outputPath = path.join(outputDir, "sample-prd.md");
    const jsonOutputPath = path.join(outputDir, "sample-prd.content.json");

    const result = await renderPrd({
      rootDir,
      payloadPath,
      outputPath,
      jsonOutputPath,
      id: "plan:sample-prd",
      title: "Sample PRD",
      summary: "Sample rendered PRD.",
      tags: ["prd"],
    });

    const markdown = await readFile(outputPath, "utf8");
    const sidecar = await readFile(jsonOutputPath, "utf8");

    expect(result.validation.valid).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.jsonOutputPath).toBe(jsonOutputPath);
    expect(markdown).toContain("$schema: schemas/work-management/frontmatter/prd.json");
    expect(markdown).toContain("## Artifact Strategy");
    expect(markdown).toContain("## Coverage Model");
    expect(markdown).toContain("## Coverage Review");
    expect(markdown).toContain("## Quality Review");
    expect(markdown).not.toContain("\n\n\n");
    expect(sidecar).toContain('"documentKind": "product-requirements"');
  });
});
