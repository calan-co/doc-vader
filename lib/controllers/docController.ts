// Controller for documentation validation
import { validateDocsWorkflow } from "../docs/utils.js";
import path from "node:path";
import Ajv from "ajv";

export async function lint(options: {
  docsDir: string;
  schemaDir?: string;
  strict?: boolean;
}) {
  const { docsDir, schemaDir, strict } = options;
  const ajv = new Ajv({ allErrors: true });
  const schemaDirectory = schemaDir || path.join(docsDir, "schemas");
  const strictMode = strict === undefined ? true : strict;
  return validateDocsWorkflow({
    docsDir,
    schemaDir: schemaDirectory,
    strict: strictMode,
    ajv,
  });
}

export { list } from "../docs/utils.js";
