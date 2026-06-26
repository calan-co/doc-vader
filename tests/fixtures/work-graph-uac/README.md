# Work Graph UAC Review Fixture

Stage the fixture into a temporary directory, then run the graph explorer from
that directory. The review commands are read-only after setup and exercise the
same JSON/DOT output extension seam used by the CLI. This review flow covers
summary, export, standalone viewer generation, filtering, inspection,
traversal, diagnostics visibility, and read-only behavior through one fixture.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
FIXTURE_ROOT="$(mktemp -d)"
TSX_IMPORT="$(
  cd "$REPO_ROOT" && \
    node -p "require('node:url').pathToFileURL(require.resolve('tsx')).href"
)"

node --import tsx "$REPO_ROOT/scripts/work-graph-uac-review-fixture.ts" "$FIXTURE_ROOT"

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph nodes --format json
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph edges --format json
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph summary
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph export --format json > graph-export.json
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph export --format dot > graph-export.dot
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph visualize --output graph-viewer.html
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph inspect wi:70001 --format json
)

(
  cd "$FIXTURE_ROOT" && \
    node --import "$TSX_IMPORT" "$REPO_ROOT/cli/doc-vader.ts" work graph inspect wi:70001 --format dot
)
```

Compare the results with:

- `tests/fixtures/work-graph-uac/expected/nodes.json`
- `tests/fixtures/work-graph-uac/expected/edges.json`
- `tests/fixtures/work-graph-uac/expected/summary.txt`
- `tests/fixtures/work-graph-uac/expected/export.json`
- `tests/fixtures/work-graph-uac/expected/export.dot`
- `tests/fixtures/work-graph-uac/expected/viewer-fragments.json`
- `tests/fixtures/work-graph-uac/expected/inspect-wi-70001.json`
- `tests/fixtures/work-graph-uac/expected/inspect-wi-70001.dot`

## UAT Review Checklist

This checklist maps every accepted scenario to one deterministic command,
artifact, or manual viewer action. Run the commands from the staged fixture
directory. Treat the repository as read-only after fixture setup; only
`graph-export.json`, `graph-export.dot`, `graph-viewer.html`, and any temporary
viewer artifact created by `work graph visualize` are expected new artifacts.

- `UAT-01` Summary surface: run `work graph summary` and compare stdout with
  `tests/fixtures/work-graph-uac/expected/summary.txt`.
- `UAT-02` Canonical export JSON: run `work graph export --format json > graph-export.json`
  and compare it with `tests/fixtures/work-graph-uac/expected/export.json`.
- `UAT-03` Canonical export DOT: run `work graph export --format dot > graph-export.dot`
  and compare it with `tests/fixtures/work-graph-uac/expected/export.dot`.
- `UAT-04` Standalone viewer artifact: run `work graph visualize` to render the
  current projected graph into a temporary HTML artifact and open it locally, or
  run `work graph visualize --output graph-viewer.html` for a deterministic
  review artifact. Confirm the generated HTML contains the stable fragments
  listed in `tests/fixtures/work-graph-uac/expected/viewer-fragments.json`.
- `UAT-05` Viewer filtering and search: open `graph-viewer.html` and use the
  search box plus node and edge type filters. The generated artifact must expose
  `graph-search`, `node-type-filters`, and `edge-type-filters`.
- `UAT-06` Viewer metadata inspection: open `graph-viewer.html`, select a node
  or edge, and verify the inspection panel shows stable ids, provenance, file
  paths, and diagnostics context without mutating the repo.
- `UAT-07` Viewer traversal and path tracing: open `graph-viewer.html`, focus a
  node neighborhood, then trace a path from `wi:70001` to `wi:70002`. Confirm
  the viewer also exposes the no-path state when reversing the direction.
- `UAT-08` Diagnostics visibility: confirm `summary.txt` reports one diagnostic,
  `export.json` keeps diagnostics as a separate top-level field, and the viewer
  artifact includes diagnostics context for `backlog/AGENTS.md`.
- `UAT-09` Read-only behavior: compare the staged fixture tree before and after
  review. Only explicit output artifacts are allowed; no new claims, locks,
  records, or audit files may be created.
- `UAT-10` Adapter seam: confirm the viewer uses the same canonical export
  payload shape regardless of whether it is sourced from the live projection,
  `graph-export.json`, stdin, or inline JSON, and that the artifact embeds
  canonical ids, metadata, and diagnostics-derived context.

### Manual-only viewer review steps

- Run `work graph visualize` to open the temporary artifact in a local browser,
  or open `graph-viewer.html` if you generated the deterministic file-backed
  artifact.
- Toggle at least one node type filter and one edge type filter, then clear the
  search field to confirm visibility changes stay local to the browser session.
- Select `wi:70001` and inspect the panel for stable metadata and provenance.
- Run one-hop focus for incoming and outgoing traversal, then clear the focus.
- Trace a path from `wi:70001` to `wi:70002`, then reverse it to confirm the
  no-path message appears.
