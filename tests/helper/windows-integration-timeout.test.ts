import { describe, expect, it } from "vitest";
import { integrationTestTimeoutMs } from "./windows-integration-timeout.js";

describe("integrationTestTimeoutMs", () => {
  it("uses multiplier-derived whole-second ceilings by platform", () => {
    expect(integrationTestTimeoutMs("win32")).toBe(17_000);
    expect(integrationTestTimeoutMs("linux")).toBe(4_000);
    expect(integrationTestTimeoutMs("darwin")).toBe(4_000);
  });
});
