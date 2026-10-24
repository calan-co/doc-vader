import { access } from "node:fs/promises";
import path from "node:path";

export const RESOURCE_ROOT = ".dv";
export const CONFIG_FILE = ".dv.yaml";
const LEGACY_CONFIG_FILE = "dv.yaml";

function warnLegacy(legacyPath: string, replacement: string): void {
  process.emitWarning(
    `Doc-Vader is using legacy ${legacyPath}; migrate it to ${replacement}.`,
    { code: "DOC_VADER_LEGACY_LAYOUT" },
  );
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

export async function resolveDefaultResourcePath(rootDir: string, relativePath: string): Promise<string> {
  const current = path.join(rootDir, RESOURCE_ROOT, relativePath);
  if (await exists(current)) return current;

  const legacy = path.join(rootDir, relativePath);
  if (await exists(legacy)) {
    warnLegacy(legacy, current);
    return legacy;
  }
  return current;
}

export async function resolveDefaultConfigPath(rootDir: string): Promise<string> {
  const current = path.join(rootDir, CONFIG_FILE);
  if (await exists(current)) return current;

  const legacy = path.join(rootDir, LEGACY_CONFIG_FILE);
  if (await exists(legacy)) {
    warnLegacy(legacy, current);
    return legacy;
  }
  return current;
}
