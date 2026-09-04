import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/task/ready.js", () => ({ selectReadyTasks: vi.fn() }));
import { selectReadyTasks } from "../lib/task/ready.js";
import {
  PUBLISHED_WORK_SELECTION_CAPABILITY,
  discoverPublishedWorkSelectionCapabilities,
  formatPublishedWorkSelectionCommand,
  decodePublishedWorkSelectionResponse,
  selectPublishedWork,
} from "../lib/work/selection.js";
import type { ReadyTaskSelection } from "../lib/task/ready.js";

const ready: ReadyTaskSelection = {
  schemaVersion: "task-ready/v1",
  candidates: [{
    id: "wi-001",
    title: "Ready fixture",
    filePath: "backlog/001.md",
    status: "ready",
    lifecycle: "active",
    type: "work-item",
    tags: [],
    dependencies: [],
    findings: [],
  }],
  exclusions: [],
};

const request = {
  capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
  request: { workItemId: "wi-001", invocationContext: { invocation: "fixture" } },
};

describe("publisher work selection contract", () => {
  it("selects a publisher-owned task-ready/v1 candidate by exact identity", async () => {
    vi.mocked(selectReadyTasks).mockResolvedValue(ready);
    const response = await selectPublishedWork(request);
    expect(response).toMatchObject({
      capability: "publisher-work-selection/v1",
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: {
        invokedCommand: "dv work select --request - --json",
        sourceResult: expect.anything(),
      },
    });
    expect(decodePublishedWorkSelectionResponse(request, response)).toEqual({
      kind: "selected",
      workItemId: "wi-001",
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      decisionArtifact: response.decisionArtifact,
    });
  });

  it("retains capability and opaque evidence for a decoded non-selection", async () => {
    const artifact = {
      invokedCommand: "dv work select --request - --json" as const,
      sourceResult: Buffer.from(JSON.stringify({ sourceSchemaVersion: "task-ready/v1" })).toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    const response = {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "not-selected" as const, code: "NOT_READY" as const },
      decisionArtifact: artifact,
    };
    expect(decodePublishedWorkSelectionResponse(request, response)).toEqual({
      kind: "not-selected",
      code: "NOT_READY",
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      decisionArtifact: artifact,
    });
  });

  it("does not expose readiness input and distinguishes known non-ready work", async () => {
    vi.mocked(selectReadyTasks).mockResolvedValue({ ...ready, candidates: [], exclusions: [{ id: "wi-001" }] } as ReadyTaskSelection);
    await expect(selectPublishedWork(request)).resolves.toMatchObject({ outcome: { kind: "not-selected", code: "NOT_READY" } });
  });

  it("returns authorization and publisher availability outcomes from publisher-owned options", async () => {
    await expect(selectPublishedWork(request, { authorize: () => false })).resolves.toMatchObject({ outcome: { code: "NOT_AUTHORIZED" } });
    await expect(selectPublishedWork(request, { authorize: () => Promise.reject(new Error("authorization unavailable")) })).resolves.toMatchObject({
      outcome: { kind: "not-selected", code: "PUBLISHER_UNAVAILABLE" },
      decisionArtifact: expect.any(Object),
    });
    vi.mocked(selectReadyTasks).mockRejectedValueOnce(new Error("offline"));
    await expect(selectPublishedWork(request)).resolves.toMatchObject({ outcome: { code: "PUBLISHER_UNAVAILABLE" } });
  });

  it.each([
    ["NOT_FOUND", request, { ...ready, candidates: [], exclusions: [] }],
    ["AMBIGUOUS", request, { ...ready, candidates: [ready.candidates[0]!, ready.candidates[0]!] }],
    ["INVALID_REQUEST", { capability: PUBLISHED_WORK_SELECTION_CAPABILITY, request: {} }, undefined],
    ["UNSUPPORTED_CAPABILITY", { capability: "publisher-work-selection/v2", request: { workItemId: "wi-001", invocationContext: {} } }, undefined],
  ] as const)("publishes %s from publisher-owned selection", async (code, fixtureRequest, fixtureReady) => {
    if (fixtureReady) vi.mocked(selectReadyTasks).mockResolvedValue(fixtureReady);
    await expect(selectPublishedWork(fixtureRequest)).resolves.toMatchObject({
      capability: code === "UNSUPPORTED_CAPABILITY" ? fixtureRequest.capability : PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "not-selected", code },
      decisionArtifact: {
        invokedCommand: "dv work select --request - --json",
      },
    });
    const response = await selectPublishedWork(fixtureRequest);
    expect(response.decisionArtifact).toHaveProperty("sourceResult");
  });

  it("retains the exact file or stdin transport invocation as evidence", async () => {
    vi.mocked(selectReadyTasks).mockResolvedValue(ready);
    await expect(selectPublishedWork(request, { invokedCommand: "dv work select --request request.json --json" })).resolves.toMatchObject({
      decisionArtifact: { invokedCommand: "dv work select --request request.json --json" },
    });
  });

  it("requires canonical base64-encoded JSON source evidence in the in-process decoder", () => {
    const artifact = {
      invokedCommand: "dv work select --request fixtures/request.json --json",
      sourceResult: Buffer.from("{}", "utf8").toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    const response = {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected" as const, workItemId: "wi-001" },
      decisionArtifact: artifact,
    };
    expect(() => decodePublishedWorkSelectionResponse(request, {
      ...response,
      decisionArtifact: { ...artifact, sourceResult: "not-base64" },
    })).toThrow();
    expect(() => decodePublishedWorkSelectionResponse(request, {
      ...response,
      decisionArtifact: { ...artifact, sourceResult: Buffer.from("not json", "utf8").toString("base64") },
    })).toThrow();
  });

  it("uses canonical shell-safe command evidence for whitespace paths", () => {
    const invokedCommand = formatPublishedWorkSelectionCommand({
      request: "fixtures/request with spaces.json",
      backlogDir: "custom backlog/it's-ready",
      json: true,
    });
    expect(invokedCommand).toBe(
      "dv work select --request 'fixtures/request with spaces.json' --backlog-dir 'custom backlog/it'\"'\"'s-ready' --json",
    );
    const artifact = {
      invokedCommand,
      sourceResult: Buffer.from("{}", "utf8").toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    const response = {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected" as const, workItemId: "wi-001" },
      decisionArtifact: artifact,
    };
    expect(decodePublishedWorkSelectionResponse(request, response)).toMatchObject({ kind: "selected" });
    const require = createRequire(import.meta.url);
    const portable = require("../consumer/publisher-work-selection-v1-decoder.cjs") as {
      decode: (request: unknown, response: unknown) => unknown;
    };
    expect(portable.decode(request, response)).toMatchObject({ kind: "selected" });
  });

  it("accepts official file transport artifacts and rejects unrelated commands", () => {
    const artifact = {
      invokedCommand: "dv work select --request fixtures/request.json --json",
      sourceResult: Buffer.from("{}", "utf8").toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    expect(decodePublishedWorkSelectionResponse(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: artifact,
    })).toMatchObject({ kind: "selected", decisionArtifact: artifact });
    expect(() => decodePublishedWorkSelectionResponse(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: { ...artifact, invokedCommand: "dv work ready --json" },
    })).toThrow();
  });

  it("publishes a Node 20-compatible standalone decoder", () => {
    const require = createRequire(import.meta.url);
    const portable = require("../consumer/publisher-work-selection-v1-decoder.cjs") as {
      decode: (request: unknown, response: unknown) => unknown;
    };
    const artifact = {
      invokedCommand: "dv work select --request fixtures/request.json --json",
      sourceResult: Buffer.from("{}", "utf8").toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    expect(portable.decode(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "not-selected", code: "NOT_READY" },
      decisionArtifact: artifact,
    })).toMatchObject({ kind: "not-selected", capability: PUBLISHED_WORK_SELECTION_CAPABILITY, decisionArtifact: artifact });
    expect(() => portable.decode(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-002" },
      decisionArtifact: artifact,
    })).toThrow();
    expect(portable.decode(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: { ...artifact, invokedCommand: "dv work select --request fixtures/request.json" },
    })).toMatchObject({ kind: "selected" });
    expect(portable.decode(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: {
        ...artifact,
        invokedCommand: "dv work select --request fixtures/request.json --backlog-dir custom-backlog --json",
      },
    })).toMatchObject({ kind: "selected" });
    expect(() => portable.decode(request, {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: { ...artifact, invokedCommand: "dv work select --request fixtures/request.json --unknown" },
    })).toThrow();
    for (const sourceResult of ["not-base64", Buffer.from("not json", "utf8").toString("base64")]) {
      expect(() => portable.decode(request, {
        capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
        outcome: { kind: "selected", workItemId: "wi-001" },
        decisionArtifact: { ...artifact, sourceResult },
      })).toThrow();
    }
  });

  it("binds request identity and invocation context consistently in both decoders", () => {
    const require = createRequire(import.meta.url);
    const portable = require("../consumer/publisher-work-selection-v1-decoder.cjs") as {
      decode: (request: unknown, response: unknown) => unknown;
    };
    const artifact = {
      invokedCommand: "dv work select --request fixtures/request.json --json",
      sourceResult: Buffer.from("{}", "utf8").toString("base64"),
      requestedWorkItemId: "wi-001",
    };
    const response = {
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      outcome: { kind: "selected" as const, workItemId: "wi-001" },
      decisionArtifact: artifact,
    };
    const missingContext = { capability: PUBLISHED_WORK_SELECTION_CAPABILITY, request: { workItemId: "wi-001" } };
    for (const decode of [decodePublishedWorkSelectionResponse, portable.decode]) {
      expect(() => decode(missingContext as never, response)).toThrow();
      expect(() => decode(request, { ...response, decisionArtifact: { ...artifact, requestedWorkItemId: null } })).toThrow();
      expect(() => decode(request, { ...response, decisionArtifact: { ...artifact, requestedWorkItemId: "wi-other" } })).toThrow();
    }
  });

  it("publishes discovery and explicit version mappings without exposing readiness semantics", () => {
    expect(discoverPublishedWorkSelectionCapabilities()).toEqual({
      schemaVersion: "publisher-work-selection-discovery/v1",
      capabilities: [PUBLISHED_WORK_SELECTION_CAPABILITY],
      versionMappings: [{ requestedCapability: PUBLISHED_WORK_SELECTION_CAPABILITY, responseCapability: PUBLISHED_WORK_SELECTION_CAPABILITY }],
    });
  });

  it.each([
    undefined,
    { capability: "publisher-work-selection/v2", outcome: { kind: "not-selected", code: "NOT_READY" }, decisionArtifact: {} },
    { capability: PUBLISHED_WORK_SELECTION_CAPABILITY, outcome: { kind: "selected", workItemId: "wi-002" }, decisionArtifact: {} },
    { capability: PUBLISHED_WORK_SELECTION_CAPABILITY, outcome: { kind: "selected", workItemId: "wi-001" } },
    { capability: PUBLISHED_WORK_SELECTION_CAPABILITY, outcome: { kind: "not-selected", code: "NOT_READY" }, decisionArtifact: { invokedCommand: "dv work select --request - --json", requestedWorkItemId: "wi-001", sourceResult: {} } },
  ])("fails closed for malformed, unsupported, mismatched, or artifact-free responses", (response) => {
    expect(() => decodePublishedWorkSelectionResponse(request, response)).toThrow();
  });
});
