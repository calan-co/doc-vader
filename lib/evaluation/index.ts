/**
 * Shared composable evaluation foundation.
 *
 * Work Item governance should define its own Work Item checks and review
 * profiles, then register or compose them through this module. The foundation
 * keeps the evaluation contracts, composition seams, and deterministic report
 * assembly reusable without pulling Work Item-specific rules into the shared
 * layer.
 */
export * from "./types.js";
export * from "./profile.js";
export * from "./report.js";

