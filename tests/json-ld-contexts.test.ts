import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type JsonLdContextFile = {
  "@context": unknown;
};

async function readContext(fileName: string): Promise<JsonLdContextFile> {
  const filePath = path.resolve(process.cwd(), "contexts", fileName);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as JsonLdContextFile;
}

describe("JSON-LD vocabulary contexts", () => {
  it("loads the base fallback context", async () => {
    const baseContext = await readContext("base.context.json");

    expect(baseContext["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        "@vocab": "https://schema.org/",
      }),
    );
  });

  it("loads the Dublin Core term mappings", async () => {
    const dublinCoreContext = await readContext("dublin-core.context.json");

    expect(dublinCoreContext["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        dc: "http://purl.org/dc/terms/",
        title: "dc:title",
        description: "dc:description",
        creator: "dc:creator",
        subject: "dc:subject",
        audience: "dc:audience",
      }),
    );
    expect(dublinCoreContext["@context"]).toEqual(
      expect.objectContaining({
        created: expect.objectContaining({
          "@id": "dc:created",
          "@type": "xsd:dateTime",
        }),
        modified: expect.objectContaining({
          "@id": "dc:modified",
          "@type": "xsd:dateTime",
        }),
      }),
    );
  });

  it("loads the schema.org namespace context", async () => {
    const schemaOrgContext = await readContext("schema-org.context.json");

    expect(schemaOrgContext["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        "@vocab": "https://schema.org/",
        schema: "https://schema.org/",
      }),
    );
  });

  it("extends the document context for work items", async () => {
    const workItemContext = await readContext("work-item.context.json");

    expect(workItemContext["@context"]).toEqual(
      expect.arrayContaining([
        "./document.context.json",
        expect.objectContaining({
          "@version": 1.1,
          wi: "http://example.org/work-item#",
          xsd: "http://www.w3.org/2001/XMLSchema#",
          id: "wi:identifier",
          type: "@type",
          priority: "wi:priority",
          estimated: expect.objectContaining({
            "@id": "wi:estimatedEffort",
            "@type": "xsd:duration",
          }),
          assignee: "wi:assignee",
        }),
      ]),
    );
  });

  it("loads the document context", async () => {
    const documentContext = await readContext("document.context.json");

    expect(documentContext["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        "@vocab": "https://schema.org/",
        dc: "http://purl.org/dc/terms/",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        id: "identifier",
        title: "name",
        summary: "description",
        owner: "author",
        tags: "keywords",
      }),
    );
    expect(documentContext["@context"]).toEqual(
      expect.objectContaining({
        created: expect.objectContaining({
          "@id": "dc:created",
          "@type": "xsd:dateTime",
        }),
        modified: expect.objectContaining({
          "@id": "dc:modified",
          "@type": "xsd:dateTime",
        }),
      }),
    );
  });
});
