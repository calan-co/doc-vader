import { describe, expect, it } from "vitest";
import {
  formatClaimReleaseMessage,
  formatGenericClaimReleaseMessage,
} from "../scripts/sandcastle/claim-release.js";

describe("sandcastle claim release messaging", () => {
  it("describes no-commit cleanup with task and branch context", () => {
    expect(
      formatClaimReleaseMessage(
        {
          taskId: "wi-60378",
          branch: "sandcastle/issue-60378",
        },
        "no-commit",
      ),
    ).toBe(
      "Released claim for wi-60378 on branch sandcastle/issue-60378 because no branch commits exist.",
    );
  });

  it("describes post-merge cleanup with task and branch context", () => {
    expect(
      formatClaimReleaseMessage(
        {
          taskId: "wi-60378",
          branch: "sandcastle/issue-60378",
        },
        "post-merge",
      ),
    ).toBe(
      "Released claim for wi-60378 on branch sandcastle/issue-60378 after host task completion.",
    );
  });

  it("falls back to a generic release message when no-commit context is not supported", () => {
    expect(
      formatGenericClaimReleaseMessage({
        taskId: "wi-60378",
        branch: "sandcastle/issue-60378",
      }),
    ).toBe("Released claim for wi-60378 on branch sandcastle/issue-60378.");
  });
});
