import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertEscalationUseOperationRecoverable,
  beginEscalationUseOperationEffect,
  disputeEscalationUseOperation,
  finalizeEscalationUseOperation,
  pendingEscalationUseOperations,
  releaseEscalationUseOperation,
  reserveEscalationUseOperation,
  updateEscalationUseOperationPhase,
  type Escalation,
  type EscalationUseOperation,
} from "../escalation/index.js";
import { assertActiveRuntimeClaimForTask } from "../runtime-claim/index.js";
import type { WorkItemCheckMutationPlan } from "../work-management/index.js";
import { Saga, SagaInterruption, SagaStore, createFileCommand, type SagaInstance } from "../work-management/saga.js";

export type EscalationUseBoundary = "reserved" | "mutation-intent" | "effect-begun" | "mutation-applied" | "completed";

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function sourceState(store: SagaStore, operation: EscalationUseOperation): Promise<"absent" | "applied" | "ambiguous"> {
  const instance = store.get(operation.sagaId);
  const command = instance?.commands.length === 1 ? instance.commands[0] : undefined;
  const relative = path.relative(store.rootDir, operation.workFilePath);
  if (!command || command.targetPath !== operation.workFilePath || command.expectedHash !== operation.expectedWorkHash
    || command.desiredHash !== operation.desiredWorkHash || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return "ambiguous";
  try {
    const [root, target] = await Promise.all([fs.realpath(store.rootDir), fs.realpath(operation.workFilePath)]);
    const targetRelative = path.relative(root, target);
    if (targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)) return "ambiguous";
    const current = hash(await fs.readFile(operation.workFilePath, "utf8"));
    if (current === operation.expectedWorkHash) return "absent";
    if (current === operation.desiredWorkHash) return "applied";
  } catch {
    return "ambiguous";
  }
  return "ambiguous";
}

function updateSaga(store: SagaStore, sagaId: string, patch: Pick<SagaInstance, "status" | "phase" | "commandIndex">, fact: string, detail?: string): void {
  const instance = store.get(sagaId);
  if (instance && instance.status !== "disputed" && instance.status !== "completed" && instance.status !== "failed") {
    store.update(instance, patch, fact, detail);
  }
}

/** Recover every unresolved use before another use can consume this escalation. */
export async function recoverEscalatedWorkCheckUses(options: { rootDir: string; escalationId: string }): Promise<void> {
  const store = new SagaStore({ rootDir: options.rootDir });
  try {
    for (const operation of pendingEscalationUseOperations(options)) {
      if (operation.phase === "disputed") {
        throw new Error(`Escalation use '${operation.id}' is disputed and blocks reuse.`);
      }
      const state = await sourceState(store, operation);
      if (state === "absent") {
        try {
          assertEscalationUseOperationRecoverable({ ...options, operationId: operation.id });
          releaseEscalationUseOperation({ ...options, operationId: operation.id });
          updateSaga(store, operation.sagaId, { status: "failed", phase: "failed", commandIndex: 0 }, "escalation-reservation-released");
          continue;
        } catch {
          disputeEscalationUseOperation({ ...options, operationId: operation.id });
          updateSaga(store, operation.sagaId, { status: "disputed", phase: "disputed", commandIndex: 0 }, "escalation-use-disputed", "Expired reservation cannot be released.");
          throw new Error(`Escalation use '${operation.id}' is disputed and blocks reuse.`);
        }
      }
      if (state === "applied") {
        try {
          finalizeEscalationUseOperation({ ...options, operationId: operation.id });
          updateSaga(store, operation.sagaId, { status: "completed", phase: "completed", commandIndex: 1 }, "escalation-use-finalized");
          continue;
        } catch {
          disputeEscalationUseOperation({ ...options, operationId: operation.id });
          updateSaga(store, operation.sagaId, { status: "disputed", phase: "disputed", commandIndex: 1 }, "escalation-use-disputed", "Persisted claim or expiry proof could not authorize finalization.");
          throw new Error(`Escalation use '${operation.id}' is disputed and blocks reuse.`);
        }
      }
      disputeEscalationUseOperation({ ...options, operationId: operation.id });
      updateSaga(store, operation.sagaId, { status: "disputed", phase: "disputed", commandIndex: 0 }, "escalation-use-disputed", "Work mutation does not match its expected or desired version.");
      throw new Error(`Escalation use '${operation.id}' is disputed and blocks reuse.`);
    }
  } finally {
    store.close();
  }
}

/** Execute the fixed one-file Work mutation with a durable escalation reservation. */
export async function executeEscalatedWorkCheckUse(options: {
  readonly rootDir: string;
  readonly escalation: Escalation;
  readonly claimToken: string;
  readonly plan: WorkItemCheckMutationPlan;
  readonly afterBoundary?: (boundary: EscalationUseBoundary) => void | Promise<void>;
}): Promise<{ readonly escalation: Escalation; readonly result: Omit<WorkItemCheckMutationPlan, "expectedMarkdown" | "desiredMarkdown" | "mutationId"> }> {
  const rootDir = path.resolve(options.rootDir);
  const sagaId = `escalation-use-${randomUUID()}`;
  const command = await createFileCommand({ rootDir, sagaId, filePath: options.plan.filePath, content: options.plan.desiredMarkdown });
  const expectedWorkHash = hash(options.plan.expectedMarkdown);
  if (command.serialized.expectedHash !== expectedWorkHash || command.serialized.desiredHash !== hash(options.plan.desiredMarkdown)) {
    throw new Error("Escalation Work mutation plan changed before reservation.");
  }
  const store = new SagaStore({ rootDir });
  let operation: EscalationUseOperation | undefined;
  let instance: SagaInstance | undefined;
  try {
    operation = reserveEscalationUseOperation({
      rootDir, id: sagaId, sagaId, escalationId: options.escalation.id, workItemId: options.plan.workItemId,
      claimToken: options.claimToken, workFilePath: options.plan.filePath, expectedWorkHash,
      desiredWorkHash: command.serialized.desiredHash, workMutationId: options.plan.mutationId,
      expectedWorkRevision: options.plan.revision,
    });
    instance = store.create(new Saga({ id: sagaId, authority: { taskId: options.plan.workItemId, claimToken: options.claimToken }, commands: [command] }));
    await options.afterBoundary?.("reserved");
    updateEscalationUseOperationPhase({ rootDir, operationId: operation.id, phase: "mutation-intent" });
    instance = store.update(instance, { status: "running", phase: "intent", commandIndex: 0 }, "escalation-mutation-intent");
    await options.afterBoundary?.("mutation-intent");
    assertActiveRuntimeClaimForTask({ rootDir, taskId: operation.workItemId, claimToken: operation.claimToken });
    beginEscalationUseOperationEffect({ rootDir, operationId: operation.id });
    await options.afterBoundary?.("effect-begun");
    await command.execute();
    updateEscalationUseOperationPhase({ rootDir, operationId: operation.id, phase: "mutation-applied" });
    instance = store.update(instance, { status: "running", phase: "applied", commandIndex: 1 }, "escalation-mutation-applied");
    await options.afterBoundary?.("mutation-applied");
    const escalation = finalizeEscalationUseOperation({ rootDir, operationId: operation.id });
    instance = store.update(instance, { status: "completed", phase: "completed", commandIndex: 1 }, "escalation-use-completed");
    await options.afterBoundary?.("completed");
    await command.cleanup();
    const { expectedMarkdown: _expectedMarkdown, desiredMarkdown: _desiredMarkdown, mutationId: _mutationId, ...result } = options.plan;
    return { escalation, result };
  } catch (error) {
    if (error instanceof SagaInterruption) throw error;
    if (operation) {
      const state = await sourceState(store, operation);
      if (state === "absent") {
        try {
          assertEscalationUseOperationRecoverable({ rootDir, operationId: operation.id });
          releaseEscalationUseOperation({ rootDir, operationId: operation.id });
          if (instance) updateSaga(store, instance.id, { status: "failed", phase: "failed", commandIndex: 0 }, "escalation-reservation-released");
        } catch {
          disputeEscalationUseOperation({ rootDir, operationId: operation.id });
          if (instance) updateSaga(store, instance.id, { status: "disputed", phase: "disputed", commandIndex: 0 }, "escalation-use-disputed", "Reservation cannot be safely released.");
        }
      } else if (state === "ambiguous") {
        disputeEscalationUseOperation({ rootDir, operationId: operation.id });
        if (instance) updateSaga(store, instance.id, { status: "disputed", phase: "disputed", commandIndex: instance.commandIndex }, "escalation-use-disputed");
      }
    }
    throw error;
  } finally {
    store.close();
  }
}
