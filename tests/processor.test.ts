/**
 * tests/processor.test.ts
 *
 * WI-229: Unified remark processor test suite and baselines.
 * Covers processor composition, plugin wiring, CLI integration, and Phase 1
 * exit-gate validation.
 */
import { describe, it, expect } from "vitest";
import { VFile } from "vfile";
import {
  createTiabProcessor,
  type TiabProcessorOptions,
} from "../lib/processor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function lint(
  markdown: string,
  options: TiabProcessorOptions = {},
  filePath = "test.md",
): Promise<VFile> {
  const processor = createTiabProcessor(options);
  const tree = processor.parse(markdown);
  const file = new VFile({ value: markdown, path: filePath });
  await processor.run(tree, file);
  return file;
}

function messageTexts(file: VFile): string[] {
  return file.messages.map((m) => m.message);
}

type RegistryFixtureCase = {
  name: string;
  nodes: Array<{
    file: string;
    id: string;
    refs: string[];
  }>;
  expected: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Suite 1: processor composition
// ---------------------------------------------------------------------------

describe("createTiabProcessor – composition", () => {
  it("returns a unified processor", () => {
    const p = createTiabProcessor();
    expect(typeof p.parse).toBe("function");
    expect(typeof p.run).toBe("function");
    expect(typeof p.stringify).toBe("function");
  });

  it("accepts empty options without throwing", () => {
    expect(() => createTiabProcessor({})).not.toThrow();
  });

  it("accepts all option keys without throwing", () => {
    const opts: TiabProcessorOptions = {
      checklist: { requiredItems: ["Task A"] },
      crossref: { rootDir: "." },
      templateCompliance: { requiredHeadings: ["Summary"] },
      diataxisClassifier: { enabled: true },
      workItemArchiveReadiness: {},
      workItemClosureEvidence: {},
    };
    expect(() => createTiabProcessor(opts)).not.toThrow();
  });

  it("parses markdown without throwing", () => {
    const p = createTiabProcessor();
    expect(() => p.parse("# Hello\n\nWorld")).not.toThrow();
  });

  it("runs the full pipeline and returns a VFile", async () => {
    const file = await lint("# Hello\n\nNo issues expected here.\n");
    expect(file).toBeInstanceOf(VFile);
  });

  it("produces a serialised string from stringify", () => {
    const p = createTiabProcessor();
    const tree = p.parse("# Title\n");
    const output = p.stringify(tree);
    expect(typeof output).toBe("string");
    expect(output).toContain("Title");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: checklist plugin wiring
// ---------------------------------------------------------------------------

describe("createTiabProcessor – checklist plugin", () => {
  it("emits no messages for a document with no checklist config", async () => {
    // Without requiredItems the plugin should be a no-op (passes validation)
    const file = await lint("# Doc\n\nSome content.\n", {});
    const checklistMessages = file.messages.filter((m) =>
      m.ruleId?.includes("checklist"),
    );
    expect(checklistMessages.length).toBe(0);
  });

  it("emits a message when a required checklist item is missing", async () => {
    const md = "# Doc\n\n- [x] Present item\n";
    const file = await lint(md, {
      checklist: { requiredItems: ["Present item", "Missing item"] },
    });
    const texts = messageTexts(file);
    expect(texts.some((t) => t.includes("Missing item"))).toBe(true);
  });

  it("emits no messages when all required items are present", async () => {
    const md = "# Doc\n\n- [x] Required A\n- [ ] Required B\n";
    const file = await lint(md, {
      checklist: { requiredItems: ["Required A", "Required B"] },
    });
    const checklistMessages = file.messages.filter((m) =>
      m.ruleId?.includes("checklist"),
    );
    expect(checklistMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: template compliance plugin wiring
// ---------------------------------------------------------------------------

describe("createTiabProcessor – templateCompliance plugin", () => {
  it("emits a message for a missing required heading", async () => {
    const md = "# Introduction\n\nContent.\n";
    const file = await lint(md, {
      templateCompliance: { requiredHeadings: ["Introduction", "Conclusion"] },
    });
    const texts = messageTexts(file);
    expect(texts.some((t) => t.includes("Conclusion"))).toBe(true);
  });

  it("emits no messages when all required headings are present", async () => {
    const md = "# Introduction\n\nContent.\n\n## Conclusion\n\nDone.\n";
    const file = await lint(md, {
      templateCompliance: { requiredHeadings: ["Introduction", "Conclusion"] },
    });
    const templateMessages = file.messages.filter((m) =>
      m.ruleId?.includes("template"),
    );
    expect(templateMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: diataxis classifier plugin wiring
// ---------------------------------------------------------------------------

describe("createTiabProcessor – diataxisClassifier plugin", () => {
  it("emits no messages when docs folder and subtype match", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await lint(md, {
      diataxisClassifier: { enabled: true },
    }, "docs/reference/guide.md");
    const diataxisMessages = file.messages.filter((m) =>
      m.ruleId?.includes("diataxis-classifier") ||
      m.message.includes("diataxis-classifier"),
    );
    expect(diataxisMessages.length).toBe(0);
  });

  it("emits a message when docs folder and subtype mismatch", async () => {
    const md = `---
title: Example
subtype: reference
---

# Reference`;
    const file = await lint(md, {
      diataxisClassifier: { enabled: true },
    }, "docs/how-to/guide.md");
    expect(
      file.messages.some((m) =>
        m.message.includes("diataxis-classifier") &&
        m.message.includes('subtype "reference"'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: crossref plugin wiring (spy-based)
// ---------------------------------------------------------------------------

describe("createTiabProcessor – crossref plugin", () => {
  it("emits a crossref message for a broken link (plugin is wired)", async () => {
    const md = "# Doc\n\n[Broken link](./definitely-missing-file.md)\n";
    const file = await lint(md, { crossref: { rootDir: "." } });
    // The plugin is wired if it detects the broken reference
    const xrefMessages = file.messages.filter(
      (m) =>
        m.ruleId?.includes("crossref") ||
        m.message.toLowerCase().includes("cross-reference") ||
        m.message.toLowerCase().includes("broken"),
    );
    expect(xrefMessages.length).toBeGreaterThan(0);
  });

  it("emits no crossref messages for external links", async () => {
    const md = "# Doc\n\n[External](https://example.com)\n";
    const file = await lint(md, { crossref: { rootDir: "." } });
    const xrefMessages = file.messages.filter(
      (m) =>
        m.ruleId?.includes("crossref") ||
        m.message.toLowerCase().includes("cross-reference"),
    );
    expect(xrefMessages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: processor isolation — independent instances
// ---------------------------------------------------------------------------

describe("createTiabProcessor – instance isolation", () => {
  it("two processors do not share message state", async () => {
    const md1 = "# Doc\n\n- [x] Item A\n";
    const md2 = "# Doc\n\n- [x] Item A\n- [x] Item B\n";
    const opts: TiabProcessorOptions = {
      checklist: { requiredItems: ["Item A", "Item B"] },
    };

    const [file1, file2] = await Promise.all([lint(md1, opts), lint(md2, opts)]);
    // file1 is missing "Item B", file2 has both
    expect(
      file1.messages.some((m) => m.message.includes("Item B")),
    ).toBe(true);
    expect(
      file2.messages.filter((m) => m.message.includes("Item B")).length,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Phase 1 exit-gate baseline
// ---------------------------------------------------------------------------

describe("Epic 170 Phase 1 – exit-gate baseline", () => {
  /**
   * These tests define the minimum pass conditions for the Phase 1 validation
   * gate. They must all pass before Phase 2 plugin tracks begin.
   *
   * Baseline measurements (recorded 2026-05-18, Node 24, M-series Mac):
   *   - Cold processor creation: < 50 ms
   *   - parse + run on a 200-line document: < 100 ms
   *
   * See docs/reference/cross-file-registry-model.md for the registry contract
   * that Phase 2 Track C plugins will depend on.
   */

  it("processor creation completes in under 500 ms", () => {
    const start = performance.now();
    createTiabProcessor();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it("full parse + run completes in under 2000 ms for a ~160-line document", async () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `## Section ${i + 1}\n\nParagraph content for section ${i + 1}.\n`,
    );
    const md = lines.join("\n");
    const start = performance.now();
    await lint(md);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it("processor handles empty document without errors", async () => {
    const file = await lint("");
    expect(file).toBeInstanceOf(VFile);
  });

  it("processor handles frontmatter without crashing", async () => {
    const md = "---\nid: test-001\ntitle: Test\n---\n\n# Test\n\nBody.\n";
    const file = await lint(md);
    expect(file).toBeInstanceOf(VFile);
  });

  it("registry fixture file is present and parseable", async () => {
    const { readFileSync } = await import("fs");
    const raw = readFileSync(
      "tests/fixtures/registry/registry-cases.json",
      "utf8",
    );
    const data = JSON.parse(raw) as { cases: RegistryFixtureCase[] };
    const caseNames = data.cases.map((entry) => entry.name);

    expect(caseNames).toEqual([
      "basic-resolution",
      "missing-target",
      "duplicate-id",
      "ambiguous-basename",
      "cycle-detection",
    ]);

    expect(data.cases).toEqual([
      {
        name: "basic-resolution",
        nodes: [
          {
            file: "backlog/100.alpha.md",
            id: "wi-100",
            refs: ["[[101.beta.md]]"],
          },
          {
            file: "backlog/101.beta.md",
            id: "wi-101",
            refs: [],
          },
        ],
        expected: {
          unresolved: 0,
          duplicateIds: 0,
        },
      },
      {
        name: "missing-target",
        nodes: [
          {
            file: "backlog/110.alpha.md",
            id: "wi-110",
            refs: ["[[missing-target]]"],
          },
        ],
        expected: {
          unresolved: 1,
        },
      },
      {
        name: "duplicate-id",
        nodes: [
          {
            file: "backlog/120.alpha.md",
            id: "wi-120",
            refs: [],
          },
          {
            file: "backlog/121.beta.md",
            id: "wi-120",
            refs: [],
          },
        ],
        expected: {
          duplicateIds: 1,
        },
      },
      {
        name: "ambiguous-basename",
        nodes: [
          {
            file: "backlog/130.alpha.md",
            id: "wi-130",
            refs: ["[[shared-name]]"],
          },
          {
            file: "backlog/shared-name.md",
            id: "wi-131",
            refs: [],
          },
          {
            file: "docs/shared-name.md",
            id: "doc-131",
            refs: [],
          },
        ],
        expected: {
          ambiguous: 1,
        },
      },
      {
        name: "cycle-detection",
        nodes: [
          {
            file: "backlog/140.alpha.md",
            id: "wi-140",
            refs: ["[[141.beta.md]]"],
          },
          {
            file: "backlog/141.beta.md",
            id: "wi-141",
            refs: ["[[140.alpha.md]]"],
          },
        ],
        expected: {
          cycles: 1,
        },
      },
    ]);
  });
});
