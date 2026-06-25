import { describe, expect, it } from "vitest";
import {
  ReadLockPolicy,
  WriteLockPolicy,
  ExecuteLockPolicy,
  canonicalizeClaimScopeRef,
} from "../lib/runtime/scope-locks.js";

describe("runtime scope lock policies", () => {
  it("evaluates the flat compatibility matrix for read, write, and execute", () => {
    const scopeRef = canonicalizeClaimScopeRef("task", "wi-60385");

    expect(ReadLockPolicy([], scopeRef)).toEqual({ allowed: true });
    expect(ReadLockPolicy(["read"], scopeRef)).toEqual({ allowed: true });
    expect(ReadLockPolicy(["execute"], scopeRef)).toEqual({ allowed: true });
    expect(ExecuteLockPolicy(["read"], scopeRef)).toEqual({ allowed: true });

    expect(WriteLockPolicy(["read"], scopeRef)).toMatchObject({
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: "write",
        conflicting_modes: ["read"],
        policy_name: "WriteLockPolicy",
      },
    });
    expect(WriteLockPolicy(["execute"], scopeRef)).toMatchObject({
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: "write",
        conflicting_modes: ["execute"],
        policy_name: "WriteLockPolicy",
      },
    });
    expect(ExecuteLockPolicy(["execute"], scopeRef)).toMatchObject({
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: "execute",
        conflicting_modes: ["execute"],
        policy_name: "ExecuteLockPolicy",
      },
    });
    expect(ExecuteLockPolicy(["write"], scopeRef)).toMatchObject({
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: "execute",
        conflicting_modes: ["write"],
        policy_name: "ExecuteLockPolicy",
      },
    });
    expect(ReadLockPolicy(["write"], scopeRef)).toMatchObject({
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: "read",
        conflicting_modes: ["write"],
        policy_name: "ReadLockPolicy",
      },
    });
  });
});
