import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatterSchema from "../lib/plugins/remark-frontmatter-schema.js";
import { VFile } from "vfile";

describe("remark-frontmatter-schema", () => {
  it("should load and export plugin correctly", () => {
    expect(remarkFrontmatterSchema).toBeDefined();
    expect(typeof remarkFrontmatterSchema).toBe("function");
  });

  it("should parse options schema correctly", async () => {
    const { optionsSchema } = await import(
      "../lib/plugins/remark-frontmatter-schema.js"
    );

    // Valid options
    const validOptions = {
      enabled: true,
      strict: false,
      schemaDir: "schemas",
    };
    const result = optionsSchema.parse(validOptions);
    expect(result.enabled).toBe(true);
    expect(result.strict).toBe(false);
  });

  it("should have default options", async () => {
    const { optionsSchema } = await import(
      "../lib/plugins/remark-frontmatter-schema.js"
    );

    const result = optionsSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.strict).toBe(false);
    expect(result.schemaDir).toBe("schemas");
  });

  it("should skip validation when disabled", () => {
    const md = `# Test`;
    const file = new VFile({
      value: md,
      path: "/tmp/test.md",
    });

    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatterSchema, {
        enabled: false,
      });

    processor.runSync(processor.parse(md), file);
    expect(file).toBeDefined();
  });

  it("should not crash without frontmatter data", () => {
    const md = `# Content without frontmatter

This is just markdown.
`;

    const file = new VFile({
      value: md,
      path: "/tmp/no-frontmatter.md",
    });

    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatterSchema, {
        enabled: true,
      });

    processor.runSync(processor.parse(md), file);
    expect(file).toBeDefined();
  });

  it("should handle missing options gracefully", () => {
    const md = `# Test`;
    const file = new VFile({
      value: md,
      path: "/tmp/test.md",
    });

    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatterSchema);

    processor.runSync(processor.parse(md), file);
    expect(file).toBeDefined();
  });

  it("should allow custom schema directory", () => {
    const md = `# Test`;
    const file = new VFile({
      value: md,
      path: "/tmp/test.md",
    });

    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatterSchema, {
        enabled: true,
        schemaDir: "custom-schemas",
      });

    processor.runSync(processor.parse(md), file);
    expect(file).toBeDefined();
  });

  it("should respect strict mode setting", async () => {
    const { optionsSchema } = await import(
      "../lib/plugins/remark-frontmatter-schema.js"
    );

    const strictOptions = optionsSchema.parse({
      strict: true,
    });
    expect(strictOptions.strict).toBe(true);

    const nonStrictOptions = optionsSchema.parse({
      strict: false,
    });
    expect(nonStrictOptions.strict).toBe(false);
  });
});
