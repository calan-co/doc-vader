// Ceiling of the observed platform maximum multiplied by 2.8.
const NON_WINDOWS_INTEGRATION_TEST_TIMEOUT_MS = 4_000;
const WINDOWS_INTEGRATION_TEST_TIMEOUT_MS = 17_000;

export function integrationTestTimeoutMs(platform = process.platform): number {
  return platform === "win32"
    ? WINDOWS_INTEGRATION_TEST_TIMEOUT_MS
    : NON_WINDOWS_INTEGRATION_TEST_TIMEOUT_MS;
}
