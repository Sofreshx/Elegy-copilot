# Codex exec spike fixture

Run from the repository root:

```text
node native/runtime/tests/fixtures/codex-exec/codex-spike.mjs all
```

Modes: `dispatch`, `resume`, `cancel`, `malformed`, or `all`.

The script creates disposable Git repositories and uses `codex exec --json` with explicit
sandbox settings. On Windows it prefers the Codex app's sandbox binary when the WindowsApps
alias cannot be launched from a child process.
