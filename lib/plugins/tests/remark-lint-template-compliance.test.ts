import { describe, it, expect } from "vitest";
import templateCompliance from "../remark-lint-template-compliance";

import { createProcessor, run as runUtil } from "./utils";
const run = async (md: string, opts: any) =>
  await runUtil(md, createProcessor(templateCompliance, opts));

import { optionsSchema } from "../remark-lint-template-compliance";

describe("remark-lint-template-compliance", () => {
  it("passes when all required headings are present", async () => {
    const md = '---\ntitle: Test\nid: "1"\n---\n\n# Heading1\n## Heading2';
    const result = await run(md, {
      requiredHeadings: ["Heading1", "Heading2"],
    });
    expect(result.messages.length).toBe(0);
  });
  it("skips heading checks when disabled", async () => {
    const result = await run("# Heading1", { enabled: false });
    expect(result.messages).toHaveLength(0);
  });

  it("fails when a required heading is missing", async () => {
    const md = '---\ntitle: Test\nid: "1"\n---\n\n# Heading1';
    const result = await run(md, {
      requiredHeadings: ["Heading1", "Heading2"],
    });
    expect(
      result.messages.some((m) =>
        m.message.includes("Missing required heading")
      )
    ).toBe(true);
  });

  it("fails when no headings are present", async () => {
    const md =
      '---\ntitle: Test\nid: "1"\n---\n\nSome content without headings.';
    const result = await run(md, {
      requiredHeadings: ["Heading1"],
    });
    expect(
      result.messages.some((m) =>
        m.message.includes('Missing required heading: "Heading1"')
      )
    ).toBe(true);
  });

  it("passes when required heading is present at any level", async () => {
    const md = "# Heading1\n### Heading2";
    const result = await run(md, {
      requiredHeadings: ["Heading2"],
    });
    expect(result.messages.length).toBe(0);
  });

  it("fails when requiredHeadings is empty", async () => {
    const md = "# Heading1";
    const result = await run(md, {
      requiredHeadings: [],
    });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(
      /requiredHeadings' must be a non-empty array/
    );
  });

  it("fails when options is not an object", async () => {
    const md = "# Heading1";
    const result = await run(md, "not-an-object" as any);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(
      /^Invalid remark-lint-template-compliance options/
    );
  });

  it("handles headings with extra whitespace", async () => {
    const md = "#   Heading1   \n## Heading2";
    const result = await run(md, {
      requiredHeadings: ["Heading1", "Heading2"],
    });
    expect(result.messages.length).toBe(0);
  });

  it("is case sensitive for headings", async () => {
    const md = "# heading1";
    const result = await run(md, {
      requiredHeadings: ["Heading1"],
    });
    expect(
      result.messages.some((m) =>
        m.message.includes('Missing required heading: "Heading1"')
      )
    ).toBe(true);
  });

  it("handles multiple missing headings", async () => {
    const md = "# OnlyOne";
    const result = await run(md, {
      requiredHeadings: ["Heading1", "Heading2", "OnlyOne"],
    });
    expect(
      result.messages.filter((m) =>
        m.message.includes("Missing required heading")
      ).length
    ).toBe(2);
  });

  it("should validate options with zod", () => {
    expect(() =>
      optionsSchema.parse({
        enabled: true,
        requiredHeadings: [],
      })
    ).toThrow();
  });

  // Frontmatter presence and YAML validity are intentionally not checked by this plugin anymore.
});
