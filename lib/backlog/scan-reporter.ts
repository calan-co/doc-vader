import type { BacklogScanReport, WorkItemScanResult } from "./scan-types.js";

function itemLine(item: WorkItemScanResult): string {
  const icon = item.errors.length > 0 ? "✗" : "✓";
  const id = item.id ?? "(no id)";
  const status = item.status ?? "(no status)";
  return `  ${icon}  ${item.file}  [id=${id}  status=${status}]`;
}

export function formatScanReportText(report: BacklogScanReport): string {
  const lines: string[] = [];
  lines.push(`Backlog Scan Report`);
  lines.push(`  Generated : ${report.generatedAt}`);
  lines.push(`  Scan ID   : ${report.scanId}`);
  lines.push(`  Directory : ${report.options.backlogDir}`);
  lines.push(``);
  lines.push(
    `Summary: ${report.summary.totalFiles} file(s)  |  ` +
      `${report.summary.filesWithErrors} with errors  |  ` +
      `${report.summary.errorCount} error(s)  |  ` +
      `${report.summary.evidenceRecordsCreated} evidence record(s) created`,
  );
  lines.push(
    `         ${report.summary.candidateItemsEvaluated} candidate(s) evaluated  |  ` +
      `${report.summary.candidatesArchived} archived  |  ` +
      `${report.summary.candidateDiscrepancies} discrepancy note(s)  |  ` +
      `${report.summary.invalidStatusUpdates} invalid status update(s)`,
  );
  lines.push(``);

  if (report.items.length === 0) {
    lines.push("  (no markdown files found)");
  } else {
    for (const item of report.items) {
      lines.push(itemLine(item));
      for (const err of item.errors) {
        lines.push(`       error [${err.code}]: ${err.message}`);
      }
    }
  }

  lines.push(``);
  lines.push(report.exitCode === 0 ? "Result: PASS" : "Result: FAIL");
  return lines.join("\n");
}

export function formatScanReportJson(report: BacklogScanReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatScanReport(report: BacklogScanReport): string {
  return report.options.reportFormat === "json"
    ? formatScanReportJson(report)
    : formatScanReportText(report);
}
