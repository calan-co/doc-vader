import { readFileSync, readlinkSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the selected work-item schema version aligned", () => {
  const directory = "schemas/frontmatter/by-type/work-item";
  const latest = readlinkSync(`${directory}/latest.json`);
  const schema = JSON.parse(readFileSync(`${directory}/${latest}`, "utf8"));

  expect(schema.version).toBe("1.1.0");
  expect(schema.$id).toMatch(/\/1\.1\.0$/);
});
