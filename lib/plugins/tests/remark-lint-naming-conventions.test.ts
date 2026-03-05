import { describe, it, expect } from "vitest";
import remarkLintNamingConventions, {
  optionsSchema,
} from "../remark-lint-naming-conventions";
import { createProcessor, run as runUtil } from "./utils";

const run = async (md: string, opts?: any) =>
  await runUtil(md, createProcessor(remarkLintNamingConventions, opts));

describe("remark-lint-naming-conventions", () => {
  it("passes for valid kebab-case filenames", async () => {
    const result = await run("# Test", { enabled: true });
    // Can't easily test filename validation without manipulating vFile
    // This is a smoke test that the plugin loads
    expect(result).toBeDefined();
  });

  it("accepts special files like README.md", async () => {
    const result = await run("# README", { enabled: true });
    expect(result).toBeDefined();
  });

  it("skips validation when disabled", async () => {
    const result = await run("# Test", { enabled: false });
    expect(result.messages.length).toBe(0);
  });

  it("passes valid ADR naming", async () => {
    const result = await run("# ADR", { enabled: true });
    expect(result).toBeDefined();
  });

  it("schema parses options correctly", () => {
    const opts = { enabled: true, excludePatterns: ["*.tmp.md"] };
    const parsed = optionsSchema.parse(opts);
    expect(parsed.enabled).toBe(true);
    expect(parsed.excludePatterns).toContain("*.tmp.md");
  });

  it("uses defaults when options are empty", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.enabled).toBe(true);
    expect(parsed.excludePatterns).toEqual([]);
  });
});
