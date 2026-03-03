import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

import { promises as fs } from "node:fs";
import matter from "gray-matter";
import {
  DIATAXIS_CATEGORIES,
  listMarkdownFiles,
  stripLeadingDiataxis,
} from "../docs-diataxis";
import { DiataxisLinter, DiataxisFixer } from "../../lib/diataxis/lint";
import { DiataxisClassifier } from "../../lib/diataxis/classify";
import { DiataxisChecker } from "../../lib/diataxis/check";

describe("DIATAXIS_CATEGORIES", () => {
  it("contains all expected categories", () => {
    expect(DIATAXIS_CATEGORIES).toEqual([
      "tutorial",
      "how-to",
      "reference",
      "explanation",
    ]);
  });
});

describe("DiataxisLinter", () => {
  it("is instance of Linter interface", () => {
    const linter = new DiataxisLinter();
    expect(typeof linter.lint).toBe("function");
  });
});

describe("DiataxisClassifier", () => {
  it("is instance of Classifier interface", () => {
    const classifier = new DiataxisClassifier();
    expect(typeof classifier.classify).toBe("function");
  });
});

describe("DiataxisChecker", () => {
  it("is instance of Checker interface", () => {
    const checker = new DiataxisChecker();
    expect(typeof checker.check).toBe("function");
  });
});

describe("stripLeadingDiataxis", () => {
  it("removes leading diataxis segment", () => {
    expect(stripLeadingDiataxis(path.join("tutorial", "foo.md"))).toBe(
      "foo.md"
    );
    expect(stripLeadingDiataxis(path.join("reference", "bar", "baz.md"))).toBe(
      path.join("bar", "baz.md")
    );
  });

  it("returns unchanged if no diataxis", () => {
    expect(stripLeadingDiataxis("other/foo.md")).toBe("other/foo.md");
  });

  it("returns unchanged for empty string", () => {
    expect(stripLeadingDiataxis("")).toBe("");
  });
});

describe("listMarkdownFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-docs-"));
    await fs.writeFile(path.join(tmpDir, "a.md"), "# A");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "not md");
    await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "sub", "c.md"), "# C");
    await fs.mkdir(path.join(tmpDir, "schemas"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "schemas", "schema.md"), "# Skip");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists only markdown files, skipping schemas and dotfiles", async () => {
    // Add a dotfile that should be skipped
    await fs.writeFile(path.join(tmpDir, ".dot.md"), "# Dotfile");

    const files = await listMarkdownFiles(tmpDir);
    expect(files).toEqual([
      path.join(tmpDir, "a.md"),
      path.join(tmpDir, "sub", "c.md"),
    ]);
  });

  it("returns empty array for empty dir", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    expect(await listMarkdownFiles(emptyDir)).toEqual([]);
  });
});

describe("DiataxisFixer", () => {
  const docsDir = "./.tmp-docs-diataxis";
  const tutorialDocsPath = path.join(docsDir, "tutorial");
  const referenceDocsPath = path.join(docsDir, "reference");
  beforeEach(async () => {
    await fs.mkdir(tutorialDocsPath, { recursive: true });
    await fs.mkdir(referenceDocsPath, { recursive: true });
    // correct file
    await fs.writeFile(
      path.join(tutorialDocsPath, "stay.md"),
      matter.stringify("Tutorial content", {
        classification: { diataxis: "tutorial" },
      })
    );
    // file with no diataxis
    await fs.writeFile(
      path.join(tutorialDocsPath, "no-diataxis.md"),
      matter.stringify("No diataxis", {})
    );
  });
  afterEach(async () => {
    await fs.rm(docsDir, { recursive: true, force: true });
  });

  it("returns 0 if no markdown files", async () => {
    const emptyDir = path.join(docsDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    const fixer = new DiataxisFixer();
    expect(await fixer.fix({ docsDir: emptyDir, dryRun: true })).toBe(0);
  });

  it("returns 0 if no moves necessary", async () => {
    const fixer = new DiataxisFixer();
    expect(await fixer.fix({ docsDir, dryRun: true })).toBe(0);
  });
  describe("moves for mismatched diataxis", () => {
    beforeEach(async () => {
      // Ensure clean state before each test
      await fs.writeFile(
        path.join(referenceDocsPath, "move-me.md"),
        matter.stringify("Tutorial content", {
          classification: { diataxis: "tutorial" },
        })
      );
    });
    it("plans moves for mismatched diataxis (dryRun)", async () => {
      // Move file from reference to tutorial
      await fs.writeFile(
        path.join(docsDir, "reference", "move-me.md"),
        matter.stringify("Tutorial content", {
          classification: { diataxis: "tutorial" },
        })
      );
      // Remove correct file to force a move
      await fs.rm(path.join(docsDir, "tutorial", "move-me.md"), {
        force: true,
      });
      const fixer = new DiataxisFixer();
      const moves = await fixer.fix({ docsDir, dryRun: true });
      expect(moves).toBe(1);
      // File should not be moved in dryRun
      expect(
        await fs.stat(path.join(docsDir, "reference", "move-me.md"))
      ).toBeTruthy();
    });

    it("moves files to correct diataxis folder", async () => {
      // Move file from reference to tutorial
      await fs.writeFile(
        path.join(docsDir, "reference", "move-me.md"),
        matter.stringify("Tutorial content", {
          classification: { diataxis: "tutorial" },
        })
      );
      await fs.rm(path.join(docsDir, "tutorial", "move-me.md"), {
        force: true,
      });
      const fixer = new DiataxisFixer();
      const moves = await fixer.fix({ docsDir, dryRun: false });
      expect(moves).toBe(1);
      // File should now exist in tutorial folder
      expect(
        await fs.stat(path.join(docsDir, "tutorial", "move-me.md"))
      ).toBeTruthy();
    });
  });
});
