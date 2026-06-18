# OpenCode ACP spike fixture

Run from the repository root:

```text
node native/runtime/tests/fixtures/opencode-acp/acp-spike.mjs all
```

Modes: `dispatch`, `resume`, `cancel`, `malformed`, or `all`.

The script creates a temporary Git repository, starts `opencode acp --cwd <fixture>` over
stdio, auto-selects only ACP `allow_once` permission options, emits a JSON result envelope,
then removes the fixture repository.
