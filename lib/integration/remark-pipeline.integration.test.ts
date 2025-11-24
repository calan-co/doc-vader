import { describe, it, expect } from "vitest";
import { createTiabProcessor } from "../processor";

const markdown = `
- [x] Task 1
- [ ] Task 2
[Link](./existing-file.md)
# Introduction
# Conclusion
`;

describe("Integration: .remarkrc.mts and createTiabProcessor", () => {
  it("should lint with all core plugins and pass when all requirements met", async () => {
    const processor = createTiabProcessor({
      checklist: { enabled: true, requiredItems: ["Task 1", "Task 2"] },
      crossref: { enabled: false }, // skip file existence for test
      templateCompliance: {
        enabled: true,
        requiredHeadings: ["Introduction", "Conclusion"],
      },
    });
    const file = await processor.process(markdown);
    expect(file.messages).toHaveLength(0);
  });

  it("should report missing checklist and heading", async () => {
    const processor = createTiabProcessor({
      checklist: { enabled: true, requiredItems: ["Task 3"] },
      crossref: { enabled: false },
      templateCompliance: { enabled: true, requiredHeadings: ["Missing"] },
    });
    const file = await processor.process(markdown);
    expect(file.messages).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("Required checklist item missing"),
      })
    );
    expect(file.messages).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("Missing required heading"),
      })
    );
    expect(file.messages).toHaveLength(2);
  });
});
