import { describe, it, expect } from "vitest";

const shouldRunRepositorySuite = process.env.RUN_SCHEMA_REPOSITORY_TESTS === "1";

if (shouldRunRepositorySuite) {
  // This delegates to jsonschema-tools' full repository compatibility suite.
  // It is opt-in because it enforces conventions beyond the default unit test target.
  require("@wikimedia/jsonschema-tools").tests.all({ logLevel: "warn" });
} else {
  describe("schema repository compatibility suite", () => {
    it("is skipped unless RUN_SCHEMA_REPOSITORY_TESTS=1", () => {
      expect(shouldRunRepositorySuite).toBe(false);
    });
  });
}
