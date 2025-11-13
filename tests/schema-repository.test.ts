// Run all jsonschema-tools schema repository tests.
// This assumes schemaBasePath is configured in .jsonschema-tools.yaml,
// or that schemaBasePath is ./
import { describe, it, expect } from "vitest";

require("@wikimedia/jsonschema-tools").tests.all({ logLevel: "warn" });
