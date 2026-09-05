/** A reusable evaluation rule over a caller-supplied context. */
export interface Policy<Context, Output> {
  evaluate(context: Context): Output;
}

/** A structured, inspectable GatePolicy outcome. */
export interface PolicyDecision {
  readonly policyId: string;
  readonly allowed: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly children?: readonly PolicyDecision[];
}

/** A policy that decides whether a Gate operation may proceed. */
export interface GatePolicy<Context> extends Policy<Context, PolicyDecision> {
  readonly id: string;
}

/**
 * A GatePolicy composed from child GatePolicies. Empty composites deny by
 * default; callers that intend a wide-open Gate must supply an allow policy.
 */
export class CompositeGatePolicy<Context> implements GatePolicy<Context> {
  readonly children: readonly GatePolicy<Context>[];

  constructor(options: {
    readonly id: string;
    readonly children: readonly GatePolicy<Context>[];
    readonly outcomePolicy?: Policy<readonly PolicyDecision[], PolicyDecision>;
  }) {
    this.id = options.id;
    this.children = options.children;
    this.outcomePolicy = options.outcomePolicy ?? allChildrenAllow(options.id);
  }

  readonly id: string;
  readonly outcomePolicy: Policy<readonly PolicyDecision[], PolicyDecision>;

  evaluate(context: Context): PolicyDecision {
    return this.outcomePolicy.evaluate(
      this.children.map((child) => child.evaluate(context)),
    );
  }
}

/** A decision point that delegates context evaluation to exactly one root policy. */
export class Gate<Context> {
  constructor(
    readonly id: string,
    readonly policy: GatePolicy<Context>,
  ) {}

  evaluate(context: Context): PolicyDecision {
    return this.policy.evaluate(context);
  }
}

export function allowPolicyDecision(policyId: string): PolicyDecision {
  return { policyId, allowed: true };
}

/** Combine child decisions with fail-closed all-of semantics. */
export function allChildrenAllow(
  policyId: string,
): Policy<readonly PolicyDecision[], PolicyDecision> {
  return {
    evaluate(children) {
      if (children.length === 0) {
        return {
          policyId,
          allowed: false,
          code: "GATE_POLICY_EMPTY",
          message: `Gate policy '${policyId}' has no child policies and is blocked by default.`,
          children,
        };
      }
      const allowed = children.every((child) => child.allowed);
      return {
        policyId,
        allowed,
        ...(allowed
          ? {}
          : {
              code: "GATE_POLICY_CHILD_BLOCKED",
              message: `Gate policy '${policyId}' was blocked by a child policy.`,
            }),
        children,
      };
    },
  };
}
