// --- tests/helper/setupTest.ts
import { afterEach, beforeEach, vi } from "vitest";
import { vol, fs } from "memfs";

beforeEach(() => {
  vi.mock("node:fs/promises", getMemfs(true));

  vi.mock("fs/promises", getMemfs(true));

  vi.mock("node:fs", getMemfs());

  vi.mock("fs", getMemfs());
});

// reset the state of in-memory file system after each test
afterEach(() => {
  vi.unmock("node:fs/promises");
  vi.unmock("fs/promises");
  vi.unmock("node:fs");
  vi.unmock("fs");
});

function getMemfs(async = false) {
  return async () => {
    return { default: fs, ...(async ? fs.promises : fs) };
  };
}
