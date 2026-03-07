import { describe, it, expect } from "vitest";
import remarkLintNoAsciiDiagrams, {
  optionsSchema,
} from "../remark-lint-no-ascii-diagrams";
import { createProcessor, run as runUtil } from "./utils";

const run = async (md: string, opts?: any) =>
  await runUtil(md, createProcessor(remarkLintNoAsciiDiagrams, opts));

describe("remark-lint-no-ascii-diagrams", () => {
  it("passes for normal code blocks", async () => {
    const md = `\`\`\`
const x = 42;
\`\`\``;
    const result = await run(md, { enabled: true });
    expect(result.messages.length).toBe(0);
  });

  it("fails for ASCII art diagrams with box drawing", async () => {
    const md = `\`\`\`
+-----+-----+
|  A  |  B  |
+-----+-----+
|  C  |  D  |
+-----+-----+
\`\`\``;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid ASCII art diagrams"),
      ),
    ).toBe(true);
  });

  it("fails for ASCII art with arrows", async () => {
    const md = `\`\`\`
Input --> Process --> Output
  |        |         |
  v        v         v
 [A]     [B]       [C]
\`\`\``;
    const result = await run(md, { enabled: true });
    expect(
      result.messages.some((m) =>
        m.message.includes("Avoid ASCII art diagrams"),
      ),
    ).toBe(true);
  });

  it("passes for short code blocks even with special chars", async () => {
    const md = `\`\`\`
a + b = c
\`\`\``;
    const result = await run(md, { enabled: true, minLines: 3 });
    expect(result.messages.length).toBe(0);
  });

  it("skips validation when disabled", async () => {
    const md = `\`\`\`
+-----+-----+
|  A  |  B  |
+-----+-----+
\`\`\``;
    const result = await run(md, { enabled: false });
    expect(result.messages.length).toBe(0);
  });

  it("respects minLines option", async () => {
    const md = `\`\`\`
+-+
|A|
+-+
\`\`\``;
    const result = await run(md, { enabled: true, minLines: 5 });
    expect(result.messages.length).toBe(0);
  });

  it("schema parses options correctly", () => {
    const opts = { enabled: true, minLines: 5 };
    const parsed = optionsSchema.parse(opts);
    expect(parsed.enabled).toBe(true);
    expect(parsed.minLines).toBe(5);
  });

  it("uses defaults when options are empty", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.enabled).toBe(true);
    expect(parsed.minLines).toBe(3);
  });
});
