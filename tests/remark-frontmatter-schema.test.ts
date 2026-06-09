import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkFrontmatterSchema from "../lib/plugins/remark-frontmatter-schema.js";
import { VFile } from "vfile";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

function makeProcessor(opts?: Parameters<typeof remarkFrontmatterSchema>[0]) {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatterSchema, opts)
    .use(remarkStringify);
}

async function processFile(
  file: VFile,
  opts?: Parameters<typeof remarkFrontmatterSchema>[0],
) {
  return makeProcessor(opts).process(file);
}

describe("remark-frontmatter-schema", () => {
  it("exports a plugin function", () => {
    expect(remarkFrontmatterSchema).toBeDefined();
    expect(typeof remarkFrontmatterSchema).toBe("function");
  });

  describe("optionsSchema", () => {
    it("parses valid options", async () => {
      const { optionsSchema } = await import(
        "../lib/plugins/remark-frontmatter-schema.js"
      );
      const result = optionsSchema.parse({
        enabled: true,
        schemaDir: "schemas",
      });
      expect(result.enabled).toBe(true);
      expect(result.schemaDir).toBe("schemas");
    });

    it("applies defaults when no options given", async () => {
      const { optionsSchema } = await import(
        "../lib/plugins/remark-frontmatter-schema.js"
      );
      const result = optionsSchema.parse({});
      expect(result.enabled).toBe(true);
      expect(result.schemaDir).toBe("schemas/frontmatter");
    });
  });

  describe("no-op guards", () => {
    it("runs without crashing when invoked with no options (defaults apply)", async () => {
      const file = new VFile({ value: "# Hello", path: "/tmp/test.md" });
      const result = await processFile(file);
      expect(result.messages).toHaveLength(0);
    });

    it("skips validation when disabled", async () => {
      const md = "---\ntype: document\n---\n# Hello";
      const file = new VFile({ value: md, path: "/tmp/test.md" });
      const result = await processFile(file, { enabled: false });
      expect(result.messages).toHaveLength(0);
    });

    it("skips files without frontmatter", async () => {
      const file = new VFile({
        value: "# No frontmatter here",
        path: "/tmp/test.md",
      });
      const result = await processFile(file, { enabled: true });
      expect(result.messages).toHaveLength(0);
    });

    it("skips files with empty frontmatter", async () => {
      const file = new VFile({
        value: "---\n---\n# Empty frontmatter",
        path: "/tmp/test.md",
      });
      const result = await processFile(file, { enabled: true });
      expect(result.messages).toHaveLength(0);
    });

    it("skips validation when no schema matches the type", async () => {
      const file = new VFile({
        value: "---\ntype: nonexistent-type\ntitle: Title\n---\n# Hello",
        path: "/tmp/test.md",
      });
      const result = await processFile(file, {
        enabled: true,
        schemaDir: os.tmpdir(),
      });
      expect(result.messages).toHaveLength(0);
    });
  });

  describe("schema validation with fixtures", () => {
    let tmpDir: string;

    const strictSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        type: { type: "string", const: "testdoc" },
        title: { type: "string" },
        required_field: { type: "string" },
      },
      required: ["type", "title", "required_field"],
      additionalProperties: true,
    };

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "remark-fm-schema-test-"),
      );
      const byTypeDir = path.join(tmpDir, "by-type", "testdoc");
      await fs.mkdir(byTypeDir, { recursive: true });
      await fs.writeFile(
        path.join(byTypeDir, "latest.json"),
        JSON.stringify(strictSchema),
        "utf8",
      );
    });

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("produces no messages for valid frontmatter", async () => {
      const md =
        "---\ntype: testdoc\ntitle: My Title\nrequired_field: yes\n---\n# Hello";
      const file = new VFile({ value: md, path: "/tmp/valid.md" });
      const result = await processFile(file, {
        enabled: true,
        schemaDir: tmpDir,
      });
      expect(result.messages).toHaveLength(0);
    });

    it("produces messages for invalid frontmatter (missing required field)", async () => {
      const md = "---\ntype: testdoc\ntitle: My Title\n---\n# Hello";
      const file = new VFile({ value: md, path: "/tmp/invalid.md" });
      const result = await processFile(file, {
        enabled: true,
        schemaDir: tmpDir,
      });
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].message).toContain("frontmatter-schema");
    });

    it("revalidates when the schema file changes on disk", async () => {
      const cacheTmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "remark-fm-schema-cache-"),
      );
      const cacheSchemaDir = path.join(cacheTmpDir, "by-type", "testdoc");
      await fs.mkdir(cacheSchemaDir, { recursive: true });
      const cacheSchemaPath = path.join(cacheSchemaDir, "latest.json");
      const docPath = path.join(cacheTmpDir, "doc.md");
      const md = "---\ntype: testdoc\ntitle: My Title\n---\n# Hello";

      await fs.writeFile(cacheSchemaPath, JSON.stringify(strictSchema), "utf8");
      await fs.writeFile(docPath, md, "utf8");

      const initial = await processFile(new VFile({ value: md, path: docPath }), {
        enabled: true,
        schemaDir: cacheTmpDir,
      });
      expect(initial.messages.length).toBeGreaterThan(0);

      await fs.writeFile(
        cacheSchemaPath,
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            type: { type: "string", const: "testdoc" },
            title: { type: "string" },
          },
          required: ["type", "title"],
          additionalProperties: true,
        }),
        "utf8",
      );
      const future = new Date(Date.now() + 2000);
      await fs.utimes(cacheSchemaPath, future, future);

      const updated = await processFile(new VFile({ value: md, path: docPath }), {
        enabled: true,
        schemaDir: cacheTmpDir,
      });
      expect(updated.messages).toHaveLength(0);

      await fs.rm(cacheTmpDir, { recursive: true, force: true });
    });

    it("severity error: produces a fatal message for invalid frontmatter", async () => {
      const md = "---\ntype: testdoc\ntitle: My Title\n---\n# Hello";
      const file = new VFile({ value: md, path: "/tmp/strict.md" });
      const processor = unified()
        .use(remarkParse)
        .use(remarkFrontmatterSchema, ["error", { enabled: true, schemaDir: tmpDir }] as any)
        .use(remarkStringify);
      const result = await processor.process(file);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages.some((m) => m.fatal === true)).toBe(true);
    });

    it("rejects unsafe type values (path traversal)", async () => {
      const md = "---\ntype: ../etc/passwd\ntitle: Title\n---\n# Hello";
      const file = new VFile({ value: md, path: "/tmp/traversal.md" });
      const result = await processFile(file, {
        enabled: true,
        schemaDir: tmpDir,
      });
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].message).toContain("Validation error");
    });
  });
});
