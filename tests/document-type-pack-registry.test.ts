import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocumentTypePackRegistry,
  loadDocumentTypePackRegistry,
} from "../lib/document-type-packs/registry.js";
import {
  mutateMarkdownQualifierLeaf,
  projectWorkItemQualifiers,
} from "../lib/work-management/qualifiers.js";
import {
  inspectWorkItemQualifiers,
  mutateWorkItemQualifier,
  transitionWorkItem,
} from "../lib/work-management/index.js";

const manifest = {
  schemaVersion: "doc-vader/document-type-pack/v1",
  namespace: "example.work",
  documentTypes: [{ type: "work-item", metadataSchema: "work.json" }],
  checklistDefinitions: [{ id: "delivery", heading: "Delivery" }],
} as const;

describe("document type pack registry", () => {
  it("loads configured manifests, validates them, and selects an exact route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dv-pack-"));
    await writeFile(join(directory, "pack.json"), JSON.stringify(manifest));
    const registry = await loadDocumentTypePackRegistry({
      config: { documentTypePacks: ["./pack.json"] },
      baseDir: directory,
    });

    expect(registry.select({ namespace: "example.work", type: "work-item" }))
      .toMatchObject({ namespace: "example.work", documentType: { type: "work-item" } });
  });

  it("rejects schema-invalid configured manifests before registration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dv-pack-invalid-"));
    await writeFile(join(directory, "pack.json"), JSON.stringify({ namespace: "example.work" }));
    await expect(loadDocumentTypePackRegistry({
      config: { documentTypePacks: ["./pack.json"] },
      baseDir: directory,
    })).rejects.toThrow("failed schema validation");
  });

  it("rejects duplicate checklist IDs during normal manifest registration", () => {
    const registry = new DocumentTypePackRegistry();
    expect(() => registry.register({
      ...manifest,
      checklistDefinitions: [
        { id: "delivery", heading: "Delivery" },
        { id: "delivery", heading: "Proof" },
      ],
    })).toThrow("Duplicate checklist definition id 'delivery'");
  });

  it("rejects duplicate checklist IDs loaded from configured manifests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dv-pack-duplicate-"));
    await writeFile(join(directory, "pack.json"), JSON.stringify({
      ...manifest,
      checklistDefinitions: [
        { id: "delivery", heading: "Delivery" },
        { id: "delivery", heading: "Proof" },
      ],
    }));
    await expect(loadDocumentTypePackRegistry({
      config: { documentTypePacks: ["./pack.json"] },
      baseDir: directory,
    })).rejects.toThrow("Duplicate checklist definition id 'delivery'");
  });

  it("uses configured pack definitions for production Work Item inspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dv-pack-work-"));
    await mkdir(join(directory, "backlog"));
    await writeFile(join(directory, "pack.json"), JSON.stringify(manifest));
    await writeFile(join(directory, ".doc.json"), JSON.stringify({
      namespace: "example.work",
      defaultType: "work-item",
      documentTypePacks: ["./pack.json"],
    }));
    await writeFile(join(directory, "backlog", "work.md"), `---\nid: wi-pack\nnamespace: example.work\ntype: work-item\n---\n\n## Delivery\n\n- [ ] Ship it\n\n## Tasks\n\n- [ ] Ignore me\n`);

    const inspection = await inspectWorkItemQualifiers({ rootDir: directory, id: "wi-pack" });
    expect(inspection.qualifier.children.map((scope) => scope.scope)).toEqual(["delivery"]);
    expect(inspection.qualifier.children[0]?.children[0]?.label).toBe("Ship it");

    await mutateWorkItemQualifier({
      rootDir: directory,
      id: "wi-pack",
      qualifierId: inspection.qualifier.children[0]!.children[0]!.id,
      status: "met",
    });
    const afterMutation = await inspectWorkItemQualifiers({ rootDir: directory, id: "wi-pack" });
    expect(afterMutation.qualifier.children[0]?.children[0]?.status).toBe("met");
  });

  it("uses configured pack checklist definitions in terminal completion gating", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dv-pack-terminal-"));
    await mkdir(join(directory, "backlog"));
    await writeFile(join(directory, "pack.json"), JSON.stringify(manifest));
    await writeFile(join(directory, ".doc.json"), JSON.stringify({
      namespace: "example.work",
      defaultType: "work-item",
      documentTypePacks: ["./pack.json"],
    }));
    const workPath = join(directory, "backlog", "work.md");
    await writeFile(workPath, `---
id: wi-pack-terminal
namespace: example.work
type: work-item
lifecycle: active
status: running
status_reason: implementation
priority: high
estimated: 1
actual: 1
links:
  evidence:
    - '[[record-pack-terminal]]'
---

## Delivery

- [ ] Ship it
`);

    await expect(transitionWorkItem({
      rootDir: directory,
      id: "wi-pack-terminal",
      status: "completed",
    })).rejects.toMatchObject({
      code: "WORK_ITEM_COMPLETION_QUALIFIERS_BLOCKED",
      details: {
        blockers: expect.arrayContaining([
          expect.objectContaining({ scope: "delivery", label: "Ship it" }),
        ]),
      },
    });

    await writeFile(workPath, (await readFile(workPath, "utf8")).replace("- [ ] Ship it", "- [x] Ship it"));
    await expect(transitionWorkItem({
      rootDir: directory,
      id: "wi-pack-terminal",
      status: "completed",
    })).resolves.toMatchObject({ id: "wi-pack-terminal" });
  });

  it("injects selected pack checklist definitions into Work projection", () => {
    const registry = new DocumentTypePackRegistry();
    registry.register(manifest);
    const selected = registry.select({ namespace: "example.work", type: "work-item" });
    const markdown = "## Delivery\n\n- [ ] Ship it\n\n## Tasks\n\n- [ ] Ignore me\n";
    const projection = projectWorkItemQualifiers(markdown, selected.checklistDefinitions);

    expect(projection.qualifier.children.map((scope) => scope.scope)).toEqual(["delivery"]);
    expect(projection.qualifier.children[0]?.children.map((check) => check.label)).toEqual(["Ship it"]);

    const check = projection.qualifier.children[0]?.children[0];
    expect(check).toBeDefined();
    expect(mutateMarkdownQualifierLeaf({
      markdown,
      id: check!.id,
      status: "met",
      definitions: selected.checklistDefinitions,
    }).markdown).toContain("- [x] Ship it");
  });
});
