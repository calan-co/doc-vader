import * as fsSync from "node:fs";
import * as path from "node:path";

export function writeBacklogConsumerConfig(
  rootDir: string,
  automation: Record<string, unknown> = {},
): void {
  fsSync.mkdirSync(path.join(rootDir, ".doc-vader"), { recursive: true });
  fsSync.writeFileSync(
    path.join(rootDir, ".doc-vader", "backlog-consumer.json"),
    JSON.stringify(
      {
        roots: {
          backlog: "backlog",
          active: "backlog",
          archive: "backlog/archive",
          records: "backlog/records",
          audit: "backlog/audit",
        },
        automation,
      },
      null,
      2,
    ),
    "utf8",
  );
}
