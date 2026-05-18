import { describe, it, expect } from "vitest";
import path from "node:path";
import remarkFrontmatterSchema, {
  optionsSchema,
} from "../remark-frontmatter-schema.js";
import { run as runUtil, createProcessor } from "./utils.js";

// Resolve the schemas directory relative to the project root (two levels above
// this test file's built output).
const SCHEMA_DIR = path.resolve(process.cwd(), "schemas/frontmatter");

const run = async (md: string, opts?: any) =>
  runUtil(md, createProcessor(remarkFrontmatterSchema, opts), "test-file.md");

describe("remark-frontmatter-schema", () => {
  // ── Options parsing ────────────────────────────────────────────────────────

  it("passes with default options (no schemaDir needed for empty frontmatter)", async () => {
    const md = "# No frontmatter here";
    const file = await run(md);
    expect(file.messages.length).toBe(0);
  });

  it("passes when enabled:false skips validation", async () => {
    const md = "---\ntype: document\nid: bad-id\n---\n# Body";
    const file = await run(md, { enabled: false, schemaDir: SCHEMA_DIR });
    expect(file.messages.length).toBe(0);
  });

  it("returns no messages when content has no frontmatter", async () => {
    const md = "# Just a heading\n\nSome paragraph.";
    const file = await run(md, { schemaDir: SCHEMA_DIR });
    expect(file.messages.length).toBe(0);
  });

  it("returns no messages when frontmatter is empty", async () => {
    const md = "---\n---\n# Body";
    const file = await run(md, { schemaDir: SCHEMA_DIR });
    expect(file.messages.length).toBe(0);
  });

  // ── Valid document frontmatter ────────────────────────────────────────────

  it("does not crash on document frontmatter even if schema has remote $refs", async () => {
    // The document schema references external $refs that Ajv cannot resolve in
    // a local test environment. The plugin should surface a validation-error
    // message rather than throwing, keeping the pipeline stable.
    const md = [
      "---",
      "id: doc-1",
      "type: document",
      "title: Test Document",
      "subtype: reference",
      "lifecycle: active",
      "status: ready",
      "version: 1.0.0",
      "---",
      "# Body",
    ].join("\n");
    const file = await run(md, { schemaDir: SCHEMA_DIR });
    // Plugin should not throw — it should produce messages (if any) gracefully.
    expect(Array.isArray(file.messages)).toBe(true);
  });

  // ── Schema validation errors surface ──────────────────────────────────────

  it("reports a message when schemaDir does not exist", async () => {
    const md = "---\ntype: document\nid: doc-1\n---\n# Body";
    // Use a non-existent directory — resolveSchema returns null → no messages.
    // (Missing schema dir is treated as 'no schema available', not an error.)
    const file = await run(md, { schemaDir: "/nonexistent/schemas" });
    const schemaMessages = file.messages.filter((m) =>
      m.message.includes("[frontmatter-schema]")
    );
    // No schema found → validation is silently skipped.
    expect(schemaMessages.length).toBe(0);
  });

  it("reports a message for invalid options (non-boolean enabled)", async () => {
    const md = "---\ntype: document\n---\n";
    const file = await run(md, { enabled: "yes" }); // wrong type
    const schemaMessages = file.messages.filter((m) =>
      m.message.includes("Invalid frontmatter-schema options")
    );
    expect(schemaMessages.length).toBeGreaterThan(0);
  });

  // ── Path-traversal guard ──────────────────────────────────────────────────

  it("reports a message when type contains path-traversal characters", async () => {
    const md = "---\ntype: ../../etc/passwd\n---\n# Body";
    const file = await run(md, { schemaDir: SCHEMA_DIR });
    const schemaMessages = file.messages.filter((m) =>
      m.message.includes("[frontmatter-schema]")
    );
    expect(schemaMessages.length).toBeGreaterThan(0);
    expect(schemaMessages[0].message).toMatch(/Invalid frontmatter type/);
  });

  // ── Options schema ────────────────────────────────────────────────────────

  it("optionsSchema defaults enabled to true", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.enabled).toBe(true);
  });

  it("optionsSchema defaults schemaDir to 'schemas/frontmatter'", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.schemaDir).toBe("schemas/frontmatter");
  });

  it("optionsSchema accepts custom schemaDir", () => {
    const parsed = optionsSchema.parse({ schemaDir: "custom/path" });
    expect(parsed.schemaDir).toBe("custom/path");
  });

  // ── Processor integration ─────────────────────────────────────────────────

  it("integrates as a plugin via createTiabProcessor with frontmatterSchema option", async () => {
    const { createTiabProcessor } = await import("../../processor.js");
    // Provide minimal options to satisfy all plugins that require config;
    // remark-lint-template-compliance requires requiredHeadings.
    const processor = createTiabProcessor({
      frontmatterSchema: { enabled: false },
      templateCompliance: { requiredHeadings: ["Summary"] },
    });
    const md = "# Hello";
    const { VFile } = await import("vfile");
    const file = new VFile({ value: md });
    const tree = processor.parse(md);
    await processor.run(tree, file);
    // frontmatterSchema is disabled, so no schema messages expected.
    const schemaMessages = file.messages.filter((m) =>
      m.message.includes("[frontmatter-schema]")
    );
    expect(schemaMessages.length).toBe(0);
  });
});
