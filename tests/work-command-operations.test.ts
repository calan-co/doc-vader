import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskCommandError } from "../lib/task/errors.js";

const loadTaskModel = vi.hoisted(() => vi.fn());
const transitionWorkItem = vi.hoisted(() => vi.fn());
const assertClaimAuthorityAvailable = vi.hoisted(() => vi.fn());
const resolveRuntimeClaimAuthority = vi.hoisted(() => vi.fn());
const loadTaskShowModel = vi.hoisted(() => vi.fn());
const renderHumanTaskShow = vi.hoisted(() => vi.fn());
const loadTaskPromptModel = vi.hoisted(() => vi.fn());
const renderSandcastlePrompt = vi.hoisted(() => vi.fn());

vi.mock("../lib/task/model.js", () => ({ loadTaskModel }));
vi.mock("../lib/task/show.js", () => ({ loadTaskShowModel, renderHumanTaskShow }));
vi.mock("../lib/task/prompt.js", () => ({ loadTaskPromptModel }));
vi.mock("../lib/task/canonical.js", () => ({ renderSandcastlePrompt }));
vi.mock("../lib/controllers/workManagementController.js", () => ({ transition: transitionWorkItem }));
vi.mock("../lib/claim/index.js", () => ({
  ClaimAuthorityUnavailableError: class ClaimAuthorityUnavailableError extends Error {},
  assertClaimAuthorityAvailable,
  initializeClaimAuthority: vi.fn(),
}));
vi.mock("../lib/runtime-claim/index.js", () => ({
  resolveRuntimeClaimAuthority,
  createRuntimeClaimCommandApi: vi.fn(),
  auditRuntimeClaimCoverage: vi.fn(),
}));

import {
  promptWorkCommand,
  recordWorkCommand,
  releaseClaimCommand,
  renderWorkShowCommand,
  showWorkCommand,
  updateWorkCommand,
  updateWorkFromInputCommand,
} from "../lib/work/command-operations.js";

describe("work command application operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a numeric work item id before updating through the package controller", async () => {
    resolveRuntimeClaimAuthority.mockReturnValue({ rootDir: "/repo" });
    loadTaskModel.mockResolvedValue({ id: "wi-60480" });
    transitionWorkItem.mockResolvedValue({
      id: "wi-60480",
      frontmatter: { status: "running" },
      filePath: "backlog/60480.md",
    });

    await expect(updateWorkCommand({ taskId: "60480", status: "running" })).resolves.toMatchObject({
      id: "wi-60480",
    });

    expect(loadTaskModel).toHaveBeenCalledWith("60480", { backlogDir: undefined });
    expect(transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: "wi-60480" }));
    expect(transitionWorkItem.mock.invocationCallOrder[0]).toBeGreaterThan(
      loadTaskModel.mock.invocationCallOrder[0]!,
    );
  });

  it("preserves show and prompt rendering through the operation boundary", async () => {
    const model = { id: "wi-60480", title: "Extract operations" };
    loadTaskShowModel.mockResolvedValue(model);
    renderHumanTaskShow.mockResolvedValue("human show");
    loadTaskPromptModel.mockResolvedValue(model);
    renderSandcastlePrompt.mockResolvedValue("sandcastle prompt");

    await expect(showWorkCommand({ taskId: "60480", backlogDir: "backlog" })).resolves.toBe(model);
    await expect(renderWorkShowCommand({ taskId: "60480", backlogDir: "backlog" })).resolves.toBe("human show");
    await expect(promptWorkCommand({ taskId: "60480", backlogDir: "backlog" })).resolves.toBe("sandcastle prompt");

    expect(loadTaskShowModel).toHaveBeenCalledWith({ taskId: "60480", backlogDir: "backlog" });
    expect(loadTaskPromptModel).toHaveBeenCalledWith({ taskId: "60480", backlogDir: "backlog" });
  });

  it("preserves command option-conflict and invalid-outcome errors", async () => {
    await expect(recordWorkCommand({ claim: "claim", type: "test-result", payloadPath: "-", json: true, porcelain: true }))
      .rejects.toThrow("Use either --json or --porcelain, not both.");
    await expect(releaseClaimCommand("claim", { outcome: "unknown", code: "x-test" }))
      .rejects.toMatchObject({ code: "CLAIM_INVALID_OUTCOME" });
  });

  it("forwards clear-estimated as part of the canonical update transaction", async () => {
    resolveRuntimeClaimAuthority.mockReturnValue({ rootDir: "/repo" });
    loadTaskModel.mockResolvedValue({ id: "wi-60480" });
    transitionWorkItem.mockResolvedValue({ id: "wi-60480" });

    await updateWorkCommand({
      taskId: "60480",
      status: "completed",
      clearEstimated: true,
    });

    expect(transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      id: "wi-60480",
      clearEstimated: true,
    }));
  });

  it("forwards clearEstimated from the versioned update payload", async () => {
    resolveRuntimeClaimAuthority.mockReturnValue({ rootDir: "/repo" });
    loadTaskModel.mockResolvedValue({ id: "wi-60480" });
    transitionWorkItem.mockResolvedValue({ id: "wi-60480" });

    await updateWorkFromInputCommand({
      taskId: "60480",
      input: '{"status":"completed","clearEstimated":true}',
    });

    expect(transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      id: "wi-60480",
      clearEstimated: true,
    }));
  });

  it("rejects an ambiguous estimated and clearEstimated payload", async () => {
    await expect(updateWorkFromInputCommand({
      taskId: "60480",
      input: '{"status":"completed","estimated":1,"clearEstimated":true}',
    })).rejects.toMatchObject({ code: "TASK_TRANSITION_INVALID_PAYLOAD" });

    expect(loadTaskModel).not.toHaveBeenCalled();
  });

  it("preserves the invalid actual-effort error before any package mutation", async () => {
    await expect(updateWorkCommand({ taskId: "60480", status: "running", actual: "nan" }))
      .rejects.toMatchObject({
        code: "TASK_UPDATE_INVALID_ACTUAL",
      } satisfies Partial<TaskCommandError>);

    expect(loadTaskModel).not.toHaveBeenCalled();
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });
});
