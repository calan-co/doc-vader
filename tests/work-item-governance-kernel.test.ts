import { describe, expect, it } from "vitest";
import {
  evaluateWorkItemGovernance,
  type WorkItemGovernanceRecord,
} from "../lib/work-management/kernel.js";

function makeRecord(
  overrides: Partial<WorkItemGovernanceRecord>,
): WorkItemGovernanceRecord {
  return {
    id: "wi-1",
    title: "Sample work item",
    status: "ready",
    lifecycle: "active",
    tags: ["afk"],
    dependencies: [],
    links: {},
    ...overrides,
  };
}

describe("work item governance kernel", () => {
  it("returns readiness, dependency, classification, evidence, and archive verdicts", () => {
    const active = evaluateWorkItemGovernance(
      makeRecord({
        dependencies: [
          {
            id: "wi-2",
            ref: "[[wi-2]]",
            satisfied: true,
            stateKnown: true,
          },
        ],
      }),
    );
    const blocked = evaluateWorkItemGovernance(
      makeRecord({
        id: "wi-3",
        title: "Blocked item",
        status: "blocked",
      }),
    );
    const closed = evaluateWorkItemGovernance(
      makeRecord({
        id: "wi-4",
        title: "Closed item",
        status: "completed",
        lifecycle: "inactive",
        tags: ["afk"],
        statusReason: "completed",
        completedDate: "2026-06-20",
        links: {
          evidence: ["[[record-20260620-wi-4]]"],
        },
      }),
    );
    const archived = evaluateWorkItemGovernance(
      makeRecord({
        id: "wi-5",
        title: "Archived item",
        status: "ready",
        lifecycle: "archived",
        archived: true,
      }),
    );
    const dependencyLinked = evaluateWorkItemGovernance(
      makeRecord({
        id: "wi-6",
        title: "Dependency linked item",
        dependencies: [
          {
            id: "wi-7",
            ref: "[[wi-7]]",
            satisfied: false,
            stateKnown: true,
          },
        ],
      }),
    );

    expect(active.readiness.ready).toBe(true);
    expect(active.dependencies.satisfied).toBe(true);
    expect(active.classification.isAfk).toBe(true);
    expect(active.classification.isHitl).toBe(false);
    expect(active.archive.eligible).toBe(false);

    expect(blocked.readiness.ready).toBe(false);
    expect(blocked.readiness.reasons.map((reason) => reason.code)).toEqual([
      "blocked",
      "not_ready",
    ]);

    expect(closed.readiness.ready).toBe(false);
    expect(closed.evidence.ready).toBe(true);
    expect(closed.archive.eligible).toBe(true);

    expect(archived.lifecycle.isArchived).toBe(true);
    expect(archived.readiness.ready).toBe(false);
    expect(archived.readiness.reasons.map((reason) => reason.code)).toContain(
      "archived",
    );

    expect(dependencyLinked.dependencies.satisfied).toBe(false);
    expect(dependencyLinked.readiness.ready).toBe(false);
    expect(
      dependencyLinked.readiness.reasons.map((reason) => reason.code),
    ).toContain("dependency_blocked");
  });

  it("treats active ready work without hitl as AFK-ready", () => {
    const active = evaluateWorkItemGovernance(
      makeRecord({ tags: ["policy"] }),
    );

    expect(active.classification).toMatchObject({ isAfk: true, isHitl: false });
    expect(active.readiness.ready).toBe(true);
  });

  it("treats legacy string evidence links as valid terminal evidence", () => {
    const closed = evaluateWorkItemGovernance(
      makeRecord({
        id: "wi-7",
        title: "Legacy evidence item",
        status: "completed",
        lifecycle: "inactive",
        statusReason: "completed",
        completedDate: "2026-07-04",
        links: {
          evidence: "[[record-20260704-wi-7]]",
        },
      }),
    );

    expect(closed.evidence.ready).toBe(true);
    expect(closed.archive.eligible).toBe(true);
  });
});
