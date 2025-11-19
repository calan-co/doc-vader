import { describe, it, expect } from "vitest";
import checklist from "../remark-lint-checklist";
import { run as runUtil, createProcessor } from "./utils";
const run = async (md: string, opts: any) =>
  await runUtil(md, createProcessor(checklist, opts));
import { ChecklistOptionsSchema } from "../remark-lint-checklist";

describe("remark-lint-checklist", () => {
  it("passes when all required items are present", async () => {
    const md =
      "- [x] Process improvement fully documented\n- [ ] Success metrics defined";
    const result = await run(md, {
      requiredItems: [
        "Process improvement fully documented",
        "Success metrics defined",
      ],
    });
    expect(result.messages.length).toBe(0);
  });

  it("fails when a required item is missing", async () => {
    const md = "- [x] Process improvement fully documented";
    const result = await run(md, {
      requiredItems: [
        "Process improvement fully documented",
        "Success metrics defined",
      ],
    });
    expect(
      result.messages.some((m) => m.message.includes("Success metrics defined"))
    ).toBe(true);
  });

  it("handles extra checklist items", async () => {
    const md = "- [x] Extra item\n- [ ] Process improvement fully documented";
    const result = await run(md, {
      requiredItems: ["Process improvement fully documented"],
    });
    expect(result.messages.length).toBe(0);
  });

  it("fails if requiredItems is missing", async () => {
    const md = "- [x] Some item";
    const result = await run(md, {});
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(/requiredItems/);
  });

  it("fails if requiredItems is empty", async () => {
    const md = "- [x] Some item";
    const result = await run(md, { requiredItems: [] });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(/requiredItems/);
  });

  it("fails if options is not an object", async () => {
    const md = "- [x] Some item";
    const result = await run(md, null);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(/null/);
  });

  it("fails if options is an array", async () => {
    const md = "- [x] Some item";
    const result = await run(md, []);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].message).toMatch(/\[\]/);
  });

  it("ignores list items without checkboxes", async () => {
    const md = "- Task 1\n- [x] Task 2";
    const result = await run(md, { requiredItems: ["Task 2"] });
    expect(result.messages.length).toBe(0);
  });

  it("handles checklist items with formatting", async () => {
    const md = "- [x] **Process improvement fully documented**";
    const result = await run(md, {
      requiredItems: ["Process improvement fully documented"],
    });
    // Should fail because formatting is stripped and doesn't match
    expect(result.messages.length).toBe(1);
  });

  it("handles checklist items with leading/trailing whitespace", async () => {
    const md = "- [x]   Process improvement fully documented   ";
    const result = await run(md, {
      requiredItems: ["Process improvement fully documented"],
    });
    expect(result.messages.length).toBe(0);
  });

  it("handles multiple checklists in different lists", async () => {
    const md = `
- [x] Process improvement fully documented

Other section:

- [ ] Success metrics defined
    `;
    const result = await run(md, {
      requiredItems: [
        "Process improvement fully documented",
        "Success metrics defined",
      ],
    });
    expect(result.messages.length).toBe(0);
  });

  it("handles checklist items with nested children", async () => {
    const md = "- [x] Process improvement fully documented\n  - [ ] Subtask";
    const result = await run(md, {
      requiredItems: ["Process improvement fully documented"],
    });
    expect(result.messages.length).toBe(0);
  });

  it("does not match partial checklist item text", async () => {
    const md = "- [x] Process improvement";
    const result = await run(md, {
      requiredItems: ["Process improvement fully documented"],
    });
    expect(result.messages.length).toBe(1);
  });

  it("should validate options with zod", () => {
    expect(() =>
      ChecklistOptionsSchema.parse({ enabled: true, requiredItems: [] })
    ).toThrow();
  });
});
