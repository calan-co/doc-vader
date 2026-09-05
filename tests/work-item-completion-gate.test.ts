import { describe, expect, it } from "vitest";
import {
  CompositeGatePolicy,
  Gate,
  allowPolicyDecision,
  type GatePolicy,
} from "../lib/work-management/policies.js";
import { WorkItemCompletionGate } from "../lib/work-management/completion-gate.js";

describe("Gate policy contracts", () => {
  it("delegates its single root policy without inspecting context", () => {
    const root: GatePolicy<{ readonly marker: string }> = {
      id: "test-root",
      evaluate: (context) =>
        context.marker === "allow"
          ? allowPolicyDecision("test-root")
          : {
              policyId: "test-root",
              allowed: false,
              code: "TEST_BLOCKED",
              message: "The root policy blocked the operation.",
            },
    };
    const gate = new Gate("test-gate", root);

    expect(gate.policy).toBe(root);
    expect(gate.evaluate({ marker: "allow" })).toMatchObject({
      policyId: "test-root",
      allowed: true,
    });
    expect(gate.evaluate({ marker: "block" })).toMatchObject({
      code: "TEST_BLOCKED",
      allowed: false,
    });
  });

  it("composes qualifier, evidence, lifecycle, and Runtime Claim package policy decisions", () => {
    const policyIds = [
      "work-item-completion-qualifier",
      "work-item-completion-evidence",
      "work-item-completion-lifecycle",
      "runtime-claim-authority",
    ] as const;
    const allow = (id: string): GatePolicy<undefined> => ({
      id,
      evaluate: () => allowPolicyDecision(id),
    });

    for (const blockedPolicyId of policyIds) {
      const denied: GatePolicy<undefined> = {
        id: blockedPolicyId,
        evaluate: () => ({
          policyId: blockedPolicyId,
          allowed: false,
          code: "TEST_BLOCKED",
          message: `${blockedPolicyId} blocked completion.`,
        }),
      };
      const gate = new WorkItemCompletionGate({
        qualifierPolicy:
          blockedPolicyId === "work-item-completion-qualifier"
            ? denied
            : allow("work-item-completion-qualifier"),
        evidencePolicy:
          blockedPolicyId === "work-item-completion-evidence"
            ? denied
            : allow("work-item-completion-evidence"),
        lifecyclePolicy:
          blockedPolicyId === "work-item-completion-lifecycle"
            ? denied
            : allow("work-item-completion-lifecycle"),
        claimAuthorityPolicy:
          blockedPolicyId === "runtime-claim-authority"
            ? denied
            : allow("runtime-claim-authority"),
      });

      const decision = gate.evaluate(undefined);
      expect(decision.allowed).toBe(false);
      expect(decision.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policyId: blockedPolicyId,
            allowed: false,
            code: "TEST_BLOCKED",
          }),
        ]),
      );
    }
  });

  it("fails closed for an empty terminal composite unless an explicit allow policy is root", () => {
    const empty = new CompositeGatePolicy<undefined>({
      id: "terminal-completion",
      children: [],
    });
    const gate = new Gate("terminal-completion", empty);
    const explicitAllow = new Gate("wide-open", {
      id: "explicit-allow",
      evaluate: () => allowPolicyDecision("explicit-allow"),
    });

    expect(gate.evaluate(undefined)).toMatchObject({
      policyId: "terminal-completion",
      allowed: false,
      code: "GATE_POLICY_EMPTY",
      children: [],
    });
    expect(explicitAllow.evaluate(undefined)).toMatchObject({
      allowed: true,
      policyId: "explicit-allow",
    });
  });
});
