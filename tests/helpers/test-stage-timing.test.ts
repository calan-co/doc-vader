import { describe, expect, it } from "vitest";
import { withTestStageTiming } from "./test-stage-timing.js";

describe("withTestStageTiming", () => {
  it("does not emit timing unless explicitly enabled", () => {
    const previous = process.env.DOC_VADER_TEST_STAGE_TIMINGS;
    const lines: string[] = [];
    delete process.env.DOC_VADER_TEST_STAGE_TIMINGS;

    try {
      withTestStageTiming(
        "cli",
        () => undefined,
        (line) => lines.push(line),
      );
    } finally {
      if (previous === undefined)
        delete process.env.DOC_VADER_TEST_STAGE_TIMINGS;
      else process.env.DOC_VADER_TEST_STAGE_TIMINGS = previous;
    }

    expect(lines).toEqual([]);
  });

  it("emits opt-in structured stage timings", () => {
    const previous = process.env.DOC_VADER_TEST_STAGE_TIMINGS;
    const lines: string[] = [];
    process.env.DOC_VADER_TEST_STAGE_TIMINGS = "1";

    try {
      expect(
        withTestStageTiming(
          "cli",
          () => "done",
          (line) => lines.push(line),
        ),
      ).toBe("done");
    } finally {
      if (previous === undefined)
        delete process.env.DOC_VADER_TEST_STAGE_TIMINGS;
      else process.env.DOC_VADER_TEST_STAGE_TIMINGS = previous;
    }

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "doc-vader.test-stage-timing",
      stage: "cli",
      outcome: "passed",
      durationMs: expect.any(Number),
    });
  });
});
