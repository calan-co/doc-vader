# Work Graph UAC Review Fixture

Stage the fixture into a temporary directory, then run the graph explorer from
that directory. The review commands are read-only after setup and exercise the
same JSON/DOT output extension seam used by the CLI.

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
- `tests/fixtures/work-graph-uac/expected/inspect-wi-70001.json`
- `tests/fixtures/work-graph-uac/expected/inspect-wi-70001.dot`

Review checklist:

- `nodes.json` includes WorkItem, Claim, Record, and Scope nodes.
- `edges.json` includes `depends_on`, `belongs_to`, `implements`, `locks`, and
  `records`.
- `edges.json` does not include canonical `blocks` or `relates_to` edges.
- `inspect-wi-70001.dot` is a renderable directed graph.
