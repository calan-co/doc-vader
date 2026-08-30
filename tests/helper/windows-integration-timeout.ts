// Keep the default timeout on non-Windows platforms while allowing Windows CI headroom.
const NON_WINDOWS_INTEGRATION_TEST_TIMEOUT_MS = 5_000;
const WINDOWS_INTEGRATION_TEST_TIMEOUT_MS = 15_000;

export function integrationTestTimeoutMs(platform = process.platform): number {
  return platform === "win32"
    ? WINDOWS_INTEGRATION_TEST_TIMEOUT_MS
    : NON_WINDOWS_INTEGRATION_TEST_TIMEOUT_MS;
}
