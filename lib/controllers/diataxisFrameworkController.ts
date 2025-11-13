// Controller for Diataxis analysis
import { stripLeadingDiataxis } from "../diataxis/classify.js";

import { validateDiataxisFolder } from "../diataxis/lint.js";

export function classify() {}

export { fix } from "../diataxis/lint.js";

export function analyzeDiataxis(filePath: string, diataxis: string) {
  // Validate diataxis folder structure
  return validateDiataxisFolder(filePath, diataxis);
}

export default {
  stripLeadingDiataxis,
};
