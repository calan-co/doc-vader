import { describe, expect, it } from "vitest";
import {
  canonicalizeScopeRef,
  canonicalizeWorkItemScopeRef,
} from "../lib/work/scope-ref.js";

describe("work item ScopeRef canonicalization", () => {
  it("normalizes wi-prefixed aliases to the canonical URI form", () => {
    expect(canonicalizeWorkItemScopeRef("wi-60343")).toBe("wi:60343");
    expect(canonicalizeWorkItemScopeRef("wi-60373-create")).toBe(
      "wi:60373-create",
    );
    expect(canonicalizeWorkItemScopeRef("work-item:60343")).toBe("wi:60343");
    expect(canonicalizeWorkItemScopeRef("wi:60343")).toBe("wi:60343");
  });

  it("rejects storage-adapter style references", () => {
    expect(() => canonicalizeWorkItemScopeRef("file:backlog/60343.md")).toThrow(
      /canonical Work Item ScopeRef/i,
    );
    expect(() => canonicalizeWorkItemScopeRef("backlog/60343.md")).toThrow(
      /canonical Work Item ScopeRef/i,
    );
  });

  it("keeps long-form entity specifiers when no short form is registered", () => {
    expect(canonicalizeScopeRef("record:record-60343")).toBe(
      "record:record-60343",
    );
  });
});
