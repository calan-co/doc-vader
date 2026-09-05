import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const schemaPath = path.resolve(
  __dirname,
  "../schemas/frontmatter/by-type/work-item/current.json",
);

describe("work-item status reasons", () => {
  it("uses the general blocked reason for proposed work and deprecates the dependency-specific token", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const proposedBranch = schema.allOf.find((entry: { oneOf?: unknown[] }) =>
      entry.oneOf?.some((candidate: { properties?: { status?: { const?: string } } }) =>
        candidate.properties?.status?.const === "proposed",
      ),
    );
    const proposed = proposedBranch.oneOf.find(
      (candidate: { properties?: { status?: { const?: string } } }) =>
        candidate.properties?.status?.const === "proposed",
    );
    const proposedReasons = proposed.properties.status_reason.anyOf[0].enum;
    const draft = proposedBranch.oneOf.find(
      (candidate: { properties?: { status?: { const?: string } } }) =>
        candidate.properties?.status?.const === "draft",
    );
    const draftReasons = draft.properties.status_reason.anyOf[0].enum;

    expect(proposedReasons).toEqual([
      "needs-triage",
      "awaiting-approval",
      "deferred",
      "blocked",
    ]);
    expect(draftReasons).toEqual([
      "needs-triage",
      "awaiting-approval",
      "deferred",
      "blocked",
      "needs-info",
    ]);
    expect([...proposedReasons, ...draftReasons]).not.toContain("blocked-by-dependency");
  });
});
