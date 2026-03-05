import { describe, it, expect } from "vitest";
import remarkLintNoHtmlAnchors, {
  optionsSchema,
} from "../remark-lint-no-html-anchors";
import { createProcessor, run as runUtil } from "./utils";

const run = async (md: string, opts?: any) =>
  await runUtil(md, createProcessor(remarkLintNoHtmlAnchors, opts));

describe("remark-lint-no-html-anchors", () => {
  it("passes for markdown without HTML anchors", async () => {
    const md = `# Heading

This is regular markdown content.
`;
    const result = await run(md, { enabled: true });
    expect(result.messages.length).toBe(0);
  });

  it("fails for <a> tag with id attribute", async () => {
    const md = `# Heading

<a id="my-anchor">Anchor text</a>
`;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid raw HTML anchor tags")
      )
    ).toBe(true);
  });

  it("fails for <a> tag with name attribute", async () => {
    const md = `# Heading

<a name="my-anchor">Anchor text</a>
`;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid raw HTML anchor tags")
      )
    ).toBe(true);
  });

  it("fails for deprecated <name> tag", async () => {
    const md = `# Heading

<name id="my-anchor"></name>
`;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid raw HTML anchor tags")
      )
    ).toBe(true);
  });

  it("passes for normal <a> tags without id/name", async () => {
    const md = `# Heading

<a href="https://example.com">Link text</a>
`;
    const result = await run(md, { enabled: true });
    expect(result.messages.length).toBe(0);
  });

  it("skips validation when disabled", async () => {
    const md = `# Heading

<a id="my-anchor">Anchor text</a>
`;
    const result = await run(md, { enabled: false });
    expect(result.messages.length).toBe(0);
  });

  it("schema parses options correctly", () => {
    const opts = { enabled: false };
    const parsed = optionsSchema.parse(opts);
    expect(parsed.enabled).toBe(false);
  });

  it("uses defaults when options are empty", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.enabled).toBe(true);
  });

  it("fails for HTML anchor with whitespace variations", async () => {
    const md = `# Heading

<a  id = "my-anchor">Anchor text</a>
`;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid raw HTML anchor tags")
      )
    ).toBe(true);
  });
});
