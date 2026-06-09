import { describe, it, expect } from "vitest";
import path from "node:path";
import remarkDiataxisClassifier, {
  optionsSchema,
} from "../remark-diataxis-classifier.js";
import { createProcessor, run as runUtil } from "./utils.js";

const run = async (md: string, opts?: any, filePath?: string) =>
  await runUtil(md, createProcessor(remarkDiataxisClassifier, opts), filePath);

describe("remark-diataxis-classifier", () => {
  it("passes when the subtype matches the docs folder", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await run(md, { enabled: true }, path.join("docs", "reference", "guide.md"));
    expect(file.messages.length).toBe(0);
  });

  it("reports a fatal message when the subtype does not match the folder", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await run(md, { enabled: true }, path.join("docs", "how-to", "guide.md"));
    expect(
      file.messages.some(
        (message) =>
          message.fatal === true &&
          message.message.includes("diataxis-classifier") &&
          message.message.includes('subtype "reference"') &&
          message.message.includes("docs/how-to/"),
      ),
    ).toBe(true);
  });

  it("reports a fatal message when the subtype is outside docs/", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await run(md, { enabled: true }, "README.md");
    expect(
      file.messages.some(
        (message) =>
          message.fatal === true &&
          message.message.includes("diataxis-classifier") &&
          message.message.includes("is not under docs/") &&
          message.message.includes('Expected docs/reference/'),
      ),
    ).toBe(true);
  });

  it("skips documents whose subtype is not a Diataxis category", async () => {
    const md = `---
title: Example
subtype: task
---

# Work Item`;
    const file = await run(md, { enabled: true }, path.join("docs", "how-to", "guide.md"));
    expect(file.messages.length).toBe(0);
  });

  it("skips validation when disabled", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await run(md, { enabled: false }, path.join("docs", "how-to", "guide.md"));
    expect(file.messages.length).toBe(0);
  });

  it("optionsSchema defaults enabled to true", () => {
    const parsed = optionsSchema.parse({});
    expect(parsed.enabled).toBe(true);
  });
});
