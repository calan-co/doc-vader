import { describe, expect, it } from "vitest";
import { classifyOperationalArtifact } from "../lib/operational-artifacts.js";
import {
  evaluateProposedChangeManifest,
  evaluateSelectedVcsChanges,
} from "../lib/integration/proposed-change.js";

describe("operational artifact policy", () => {
  it("allowlists only local runtime and agent artifacts", () => {
    expect(
      classifyOperationalArtifact(".doc-vader/runtime/runtime.sqlite"),
    ).toMatchObject({ kind: "operational", reason: "runtime-authority" });
    expect(classifyOperationalArtifact(".pi/sessions/agent.json")).toMatchObject({
      kind: "operational",
      reason: "agent-local",
    });
    expect(classifyOperationalArtifact("notes/runtime.sqlite")).toMatchObject({
      kind: "unknown" });
  });

  it("rejects selected ignored files before a VCS adapter commits or publishes", () => {
    expect(
      evaluateSelectedVcsChanges([
        { path: ".pi/force-added.json", classification: "ignored" },
        { path: "scratch.log", classification: "ignored" },
        { path: "diagram.bin", classification: "binary" },
      ]),
    ).toMatchObject({
      allowed: false,
      evidence: {
        rejected: [
          expect.objectContaining({
            code: "OPERATIONAL_ARTIFACT",
            path: ".pi/force-added.json",
          }),
          expect.objectContaining({
            code: "IGNORED_ARTIFACT",
            path: "scratch.log",
          }),
          expect.objectContaining({
            code: "BINARY_ARTIFACT",
            path: "diagram.bin",
          }),
        ],
      },
    });
  });

  it("fails closed for selected forbidden artifacts and records explicit exceptions", () => {
    const evaluation = evaluateProposedChangeManifest({
      schemaVersion: "proposed-change/v1",
      changes: [
        {
          path: ".doc-vader/runtime/runtime.sqlite",
          classification: "binary",
        },
        { path: "scratch.log", classification: "ignored" },
        { path: "diagram.bin", classification: "binary" },
        { path: "new/path", classification: "unknown" },
        { path: "backlog/60462.md", classification: "governed" },
      ],
      exceptions: [
        {
          id: "exception-scratch-log",
          path: "scratch.log",
          reason: "approved migration input",
          approvedBy: "maintainer",
          approvedAt: "2026-08-14T00:00:00.000Z",
        },
        {
          id: "exception-unknown-path",
          path: "new/path",
          reason: "attempted classification bypass",
          approvedBy: "maintainer",
          approvedAt: "2026-08-14T00:00:00.000Z",
        },
        {
          id: "exception-unselected-path",
          path: "not-selected.txt",
          reason: "orphaned exception",
          approvedBy: "maintainer",
          approvedAt: "2026-08-14T00:00:00.000Z",
        },
      ],
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.evidence).toEqual(
      expect.objectContaining({
        exceptions: expect.arrayContaining([
          expect.objectContaining({
            id: "exception-scratch-log",
            disposition: "applied",
          }),
          expect.objectContaining({
            id: "exception-unknown-path",
            disposition: "rejected",
          }),
          expect.objectContaining({
            id: "exception-unselected-path",
            disposition: "rejected",
          }),
        ]),
        rejected: expect.arrayContaining([
          expect.objectContaining({
            path: ".doc-vader/runtime/runtime.sqlite",
            code: "OPERATIONAL_ARTIFACT",
          }),
          expect.objectContaining({ path: "diagram.bin", code: "BINARY_ARTIFACT" }),
          expect.objectContaining({ path: "new/path", code: "UNKNOWN_ARTIFACT" }),
        ]),
      }),
    );
  });
});
