## UAT Review Checklist

This checklist maps every accepted scenario to one deterministic command,
artifact, or manual viewer action. Run the commands from the staged fixture
directory. Treat the repository as read-only after fixture setup; only
`graph-export.json`, `graph-export.dot`, and `graph-viewer.html` are expected
new artifacts.

- `UAT-01` Summary surface: run `work graph summary` and compare stdout with
  `tests/fixtures/work-graph-uac/expected/summary.txt`.
- `UAT-02` Canonical export JSON: run `work graph export --format json > graph-export.json`
  and compare it with `tests/fixtures/work-graph-uac/expected/export.json`.
- `UAT-03` Canonical export DOT: run `work graph export --format dot > graph-export.dot`
  and compare it with `tests/fixtures/work-graph-uac/expected/export.dot`.
- `UAT-04` Standalone viewer artifact: run `work graph visualize --input graph-export.json --output graph-viewer.html`
  and confirm the generated HTML contains the stable fragments listed in
  `tests/fixtures/work-graph-uac/expected/viewer-fragments.json`.
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
- `UAT-10` Adapter seam: confirm the viewer is generated from `graph-export.json`
  rather than direct projection internals and that the artifact embeds canonical
  ids, metadata, and diagnostics-derived context.

### Manual-only viewer review steps

- Open `graph-viewer.html` in a local browser.
- Toggle at least one node type filter and one edge type filter, then clear the
  search field to confirm visibility changes stay local to the browser session.
- Select `wi:70001` and inspect the panel for stable metadata and provenance.
- Run one-hop focus for incoming and outgoing traversal, then clear the focus.
- Trace a path from `wi:70001` to `wi:70002`, then reverse it to confirm the
  no-path message appears.
