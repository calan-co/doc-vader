// Controller for backlog operations
export { list } from "../backlog/index.js";
export {
  auditBacklog as validate,
  formatAuditReportText,
} from "../backlog/audit.js";
export { scanBacklog } from "../backlog/scan-executor.js";
export {
  formatScanReport,
  formatScanReportText,
  formatScanReportJson,
} from "../backlog/scan-reporter.js";
export type { BacklogScanOptions, BacklogScanReport } from "../backlog/scan-types.js";
