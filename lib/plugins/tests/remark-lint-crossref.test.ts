import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crossref, { CrossrefOptions } from "../remark-lint-crossref";
import fs from "fs";
import { CrossrefOptionsSchema } from "../remark-lint-crossref";

import { createProcessor, run as runUtil } from "./utils";
const run = async (md: string, opts?: any) =>
  await runUtil(md, createProcessor(crossref, opts));

describe("remark-lint-crossref", () => {
  function callIfFunction<T>(maybeFunc: T | (() => T)): T {
    return typeof maybeFunc === "function"
      ? (maybeFunc as () => T)()
      : maybeFunc;
  }
  beforeEach(() => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue('id: "anchor"');
  });
  afterEach(() => {
    callIfFunction((fs.existsSync as any).mockRestore);
    callIfFunction((fs.readFileSync as any).mockRestore);
  });
  it("passes for valid crossref", async () => {
    const md = "[Link](./file.md#anchor)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("fails for missing file", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const md = "[Link](./missing.md)";
    const result = await run(md, { rootDir: "." });
    expect(
      result.messages.some((m) => m.message.includes("Broken cross-reference"))
    ).toBe(true);
  });

  it("fails for missing anchor", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("");
    const md = "[Link](./file.md#anchor)";
    const result = await run(md, { rootDir: "." });
    expect(
      result.messages.some((m) => m.message.includes("Missing anchor"))
    ).toBe(true);
  });

  it("passes for absolute links (not checked)", async () => {
    const md = "[Google](https://google.com)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("passes for anchor found as markdown heading", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("#anchor\nSome text");
    const md = "[Link](./file.md#anchor)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
    (fs.existsSync as any).mockRestore();
    (fs.readFileSync as any).mockRestore();
  });

  it("handles links with multiple anchors", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue('id: "anchor1"\n#anchor2');
    const md = "[A](./file.md#anchor1) [B](./file.md#anchor2)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("handles links with no url", async () => {
    const md = "[Empty]()";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("handles links with query params and anchor", async () => {
    const md = "[Link](./file.md?foo=bar#anchor)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("handles links with spaces in filename", async () => {
    const md = "[Link](./file name.md#anchor)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("options should not be required", async () => {
    const md = "[Link](./file.md)";
    const result = await run(md);
    expect(result.messages.length).toBe(0);
  });

  it("handles options as array error", async () => {
    const opts: CrossrefOptions = { rootDir: "." };
    const md = "[Link](./file.md)";
    const result = await run(md, [opts]);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(
      /Invalid remark-lint-crossref options/
    );
  });

  it("handles invalid rootDir type", async () => {
    const md = "[Link](./file.md)";
    const result = await run(md, { rootDir: 123 });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(/rootDir/);
  });

  it("handles link to non-md file", async () => {
    const md = "[Image](./image.png)";
    const result = await run(md, { rootDir: "." });
    expect(result.messages.length).toBe(0);
  });

  it("handles link with hash but no anchor", async () => {
    const md = "[Link](./file.md#)";
    const result = await run(md, { rootDir: "." });
    expect(
      result.messages.some((m) => m.message.includes("Missing anchor"))
    ).toBe(true);
    (fs.existsSync as any).mockRestore();
    (fs.readFileSync as any).mockRestore();
  });

  it("should validate options with zod", () => {
    expect(() => CrossrefOptionsSchema.parse({ enabled: true })).not.toThrow();
  });

  it("should skip lint if disabled", async () => {
    const processor = createProcessor(crossref, { enabled: false });
    const result = await runUtil("[Link](./file.md)", processor);
    expect(result.messages.length).toBe(0);
  });
});
