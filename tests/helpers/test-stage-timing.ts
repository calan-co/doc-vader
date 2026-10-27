type TestStage = "git-setup" | "cli" | "sqlite" | "filesystem-cleanup";
type TimingWriter = (line: string) => unknown;

export function withTestStageTiming<T>(
  stage: TestStage,
  operation: () => T,
  write: TimingWriter = process.stdout.write.bind(process.stdout),
): T {
  if (process.env.DOC_VADER_TEST_STAGE_TIMINGS !== "1") return operation();

  const startedAt = performance.now();
  const report = (outcome: "passed" | "failed") =>
    write(
      `${JSON.stringify({
        event: "doc-vader.test-stage-timing",
        stage,
        outcome,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })}\n`,
    );

  try {
    const result = operation();
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          report("passed");
          return value;
        },
        (error) => {
          report("failed");
          throw error;
        },
      ) as T;
    }
    report("passed");
    return result;
  } catch (error) {
    report("failed");
    throw error;
  }
}
