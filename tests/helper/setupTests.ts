// --- tests/helper/setupTest.ts
import { afterEach, beforeEach, vi } from "vitest";
import { vol, fs } from "memfs";
import { toTreeSync } from "memfs/lib/print";

vi.mock("node:fs/promises", getMemfs(true));

vi.mock("fs/promises", getMemfs(true));

vi.mock("node:fs", getMemfs());

vi.mock("fs", getMemfs());

// reset the state of in-memory file system after each test
afterEach(() => {
  vol.reset();
  vi.resetModules();
});

function getMemfs(async = false) {
  return async () => {
    console.log(toTreeSync(fs));
    return { default: fs, ...(async ? fs.promises : fs) };
  };
}
