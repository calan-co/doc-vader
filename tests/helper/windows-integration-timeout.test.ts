import { describe, expect, it } from "vitest";
import { integrationTestTimeoutMs } from "./windows-integration-timeout.js";

describe("integrationTestTimeoutMs", () => {
  it("uses the configured timeout policy by platform", () => {
    expect(integrationTestTimeoutMs("win32")).toBe(15_000);
    expect(integrationTestTimeoutMs("linux")).toBe(5_000);
    expect(integrationTestTimeoutMs("darwin")).toBe(5_000);
  });
});
