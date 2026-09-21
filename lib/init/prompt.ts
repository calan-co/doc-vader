import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { InitPack, InitPrompt } from "./index.js";

export function createTerminalInitPrompt(
  input: Readable,
  output: Writable,
  isTTY: boolean,
): InitPrompt {
  const ask = async (question: string): Promise<string> => {
    const readline = createInterface({ input, output, terminal: isTTY });
    try {
      return await readline.question(question);
    } finally {
      readline.close();
    }
  };

  return {
    isTTY,
    async select(packs: readonly InitPack[]): Promise<string[]> {
      output.write(`${packs.map((pack) => `${pack.id}: ${pack.name}`).join("\n")}\n`);
      return (await ask("Pack IDs (comma-separated): "))
        .split(",").map((id) => id.trim()).filter(Boolean);
    },
    async confirm(packs: readonly InitPack[]): Promise<boolean> {
      return /^(y|yes)$/i.test(await ask(`Initialize ${packs.map((pack) => pack.id).join(", ")}? [y/N] `));
    },
  };
}
