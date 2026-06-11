import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function loadContext(fileName: string) {
  const filePath = path.resolve(process.cwd(), "contexts", fileName);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as { "@context": Record<string, unknown> | Array<unknown> };
}

describe("JSON-LD vocabulary contexts", () => {
  it("provides the reusable context files required by issue 218", async () => {
    const dublinCore = await loadContext("dublin-core.context.json");
    expect(dublinCore["@context"]).toEqual(
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
    expect(dublinCore["@context"]).toEqual(
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

    const schemaOrg = await loadContext("schema-org.context.json");
    expect(schemaOrg["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        "@vocab": "https://schema.org/",
        schema: "https://schema.org/",
      }),
    );

    const workItem = await loadContext("work-item.context.json");
    expect(workItem["@context"]).toEqual(
      expect.arrayContaining([
        "./document.context.json",
        expect.objectContaining({
          wi: "http://example.org/work-item#",
          dc: "http://purl.org/dc/terms/",
          xsd: "http://www.w3.org/2001/XMLSchema#",
          id: "wi:identifier",
          type: "@type",
          title: "name",
          priority: "wi:priority",
          assignee: "wi:assignee",
          tags: "keywords",
        }),
      ]),
    );

    const document = await loadContext("document.context.json");
    expect(document["@context"]).toEqual(
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

    const base = await loadContext("base.context.json");
    expect(base["@context"]).toEqual(
      expect.objectContaining({
        "@version": 1.1,
        "@vocab": "https://schema.org/",
      }),
    );
  });
});
