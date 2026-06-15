import { describe, expect, it } from "vitest";
import {
  DEFAULT_PULL_REQUEST_PATH,
  DEFAULT_REQUIRED_CANDIDATE_FIELDS,
  DEFAULT_WORK_ITEM_MATCH_PATTERNS,
  extractStringValuesAtPath,
  extractSubjectTokens,
  getValueByPath,
  matchesWorkItemId,
  normalizePullRequestPath,
  normalizeRequiredFieldRules,
  normalizeWorkItemMatchPatterns,
} from "../lib/backlog/configurable-rules.js";

describe("configurable backlog rules", () => {
  it("uses documented defaults", () => {
    expect(DEFAULT_WORK_ITEM_MATCH_PATTERNS).toEqual(["work-item:"]);
    expect(DEFAULT_PULL_REQUEST_PATH).toBe("links.pull_requests");
    expect(DEFAULT_REQUIRED_CANDIDATE_FIELDS).toEqual([
      { field: "actual" },
      { field: "status", values: ["completed"] },
    ]);
  });

  it("normalizes work item match patterns with fallback", () => {
    expect(normalizeWorkItemMatchPatterns(undefined)).toEqual(["work-item:"]);
    expect(normalizeWorkItemMatchPatterns([" wi- ", "", "wi-"])).toEqual([
      "wi-",
    ]);
  });

  it("normalizes pull request path with fallback", () => {
    expect(normalizePullRequestPath(undefined)).toBe("links.pull_requests");
    expect(normalizePullRequestPath("  links.prs  ")).toBe("links.prs");
  });

  it("normalizes required candidate field rules with fallback", () => {
    expect(normalizeRequiredFieldRules(undefined)).toEqual([
      { field: "actual" },
      { field: "status", values: ["completed"] },
    ]);

    expect(
      normalizeRequiredFieldRules([
        "actual",
        { field: "status", values: ["aborted", "aborted", ""] },
      ]),
    ).toEqual([{ field: "actual" }, { field: "status", values: ["aborted"] }]);
  });

  it("reads nested values by dotted path", () => {
    const source = {
      links: {
        pull_requests: ["https://example.com/pr/1"],
      },
      status: "completed",
    };

    expect(getValueByPath(source, "links.pull_requests")).toEqual([
      "https://example.com/pr/1",
    ]);
    expect(getValueByPath(source, "status")).toBe("completed");
    expect(getValueByPath(source, "links.missing")).toBeUndefined();
  });

  it("extracts string values from both object-array and list-of-maps paths", () => {
    const objectShape = {
      links: {
        pull_requests: ["https://example.com/pr/1", "https://example.com/pr/2"],
      },
    };
    expect(extractStringValuesAtPath(objectShape, "links.pull_requests")).toEqual([
      "https://example.com/pr/1",
      "https://example.com/pr/2",
    ]);

    const listShape = {
      links: [{ pull_request: "https://example.com/pr/3" }],
    };
    expect(extractStringValuesAtPath(listShape, "links.pull_requests")).toEqual([
      "https://example.com/pr/3",
    ]);
  });

  it("extracts subject tokens based on configured prefixes", () => {
    const body = "Tracks WI-228 and work-item:feature-3 and wi-228.";
    expect(extractSubjectTokens(body)).toEqual(["work-item:feature-3"]);
    expect(extractSubjectTokens(body, ["work-item:", "wi-"])).toEqual(
      expect.arrayContaining(["wi-228", "work-item:feature-3"]),
    );
  });

  it("matches work item IDs against configured prefixes", () => {
    expect(matchesWorkItemId("work-item:123")).toBe(true);
    expect(matchesWorkItemId("wi-123")).toBe(false);
    expect(matchesWorkItemId("wi-123", ["wi-"])).toBe(true);
  });
});
