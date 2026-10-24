import { describe, expect, it, vi } from "vitest";

const inspectWorkActionPolicy = vi.hoisted(() => vi.fn(() => ({
  actions: [{ verb: "start" }],
})));

vi.mock("../lib/work-management/frontmatter-lint.js", () => ({
  inspectWorkActionPolicy,
}));

describe("work command inventory", () => {
  it("defers action-policy inspection until inventory is requested", async () => {
    vi.resetModules();
    inspectWorkActionPolicy.mockClear();

    const { getWorkCommandInventory } = await import(
      "../lib/work/command-inventory.js"
    );

    expect(inspectWorkActionPolicy).not.toHaveBeenCalled();
    expect(getWorkCommandInventory().map(({ name }) => name)).toContain("start");
    expect(inspectWorkActionPolicy).toHaveBeenCalledOnce();
  });

  it("keeps base commands available when action-policy inspection fails", async () => {
    vi.resetModules();
    inspectWorkActionPolicy.mockImplementationOnce(() => {
      throw new Error("schema unavailable");
    });

    const { getWorkCommandInventory } = await import(
      "../lib/work/command-inventory.js"
    );

    expect(getWorkCommandInventory().map(({ name }) => name)).toEqual(
      expect.arrayContaining(["graph", "record"]),
    );
    expect(getWorkCommandInventory().map(({ name }) => name)).not.toContain(
      "start",
    );
  });
});
