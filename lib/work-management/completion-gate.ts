import {
  CompositeGatePolicy,
  Gate,
  type GatePolicy,
} from "./policies.js";

/**
 * The Work Item package's terminal gate. Domain-specific policy children
 * project and inspect their own facts; this Gate only owns their root policy.
 */
export class WorkItemCompletionGate<Context> extends Gate<Context> {
  constructor(options: {
    readonly qualifierPolicy: GatePolicy<Context>;
    readonly evidencePolicy: GatePolicy<Context>;
    readonly lifecyclePolicy: GatePolicy<Context>;
    /** Contributed by the Runtime Claim package; not a Work Item qualifier. */
    readonly claimAuthorityPolicy: GatePolicy<Context>;
  }) {
    super(
      "work-item-completion",
      new CompositeGatePolicy({
        id: "work-item-completion",
        children: [
          options.qualifierPolicy,
          options.evidencePolicy,
          options.lifecyclePolicy,
          options.claimAuthorityPolicy,
        ],
      }),
    );
  }
}
