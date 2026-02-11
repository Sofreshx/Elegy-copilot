# agent-browser Skill

Browser automation CLI for AI agents. Uses Playwright under the hood with a client-daemon architecture optimized for LLM workflows.

## When to Use
- AI agent needs to explore, test, or validate a web application
- Exploratory E2E testing (as opposed to scripted regression — use Playwright CLI for that)
- Visual verification of features after implementation
- Bug hunting and UX validation

## Installation
```bash
npm install -g agent-browser   # or as devDependency
agent-browser install           # downloads Chromium
```

## Core Workflow (Snapshot-Ref Pattern)

The optimal AI workflow:
```bash
# 1. Navigate to the page
agent-browser open http://localhost:5173 --ignore-https-errors

# 2. Get accessibility tree with element refs
agent-browser snapshot -i --json
# Returns: { "success": true, "data": { "snapshot": "...", "refs": { "e1": {...}, ... } } }

# 3. Interact using refs from the snapshot
agent-browser click @e2          # Click by ref
agent-browser fill @e3 "text"    # Fill input by ref
agent-browser get text @e1       # Read text by ref

# 4. Re-snapshot after page changes
agent-browser snapshot -i --json
```

**Why refs?** Deterministic element selection from snapshots. No DOM re-query needed. AI-friendly.

## Essential Commands

### Navigation & Interaction
```bash
agent-browser open <url> [--headed] [--ignore-https-errors]
agent-browser click <sel>              # Click element
agent-browser fill <sel> <text>        # Clear and fill input
agent-browser type <sel> <text>        # Type into element
agent-browser press <key>             # Press key (Enter, Tab, etc.)
agent-browser hover <sel>             # Hover element
agent-browser select <sel> <val>      # Select dropdown option
agent-browser scroll <dir> [px]       # Scroll page
agent-browser back / forward / reload
```

### Observation
```bash
agent-browser snapshot                 # Full accessibility tree
agent-browser snapshot -i             # Interactive elements only
agent-browser snapshot -i -C          # Include cursor-interactive elements
agent-browser snapshot -c             # Compact (no empty structural elements)
agent-browser snapshot -d 3           # Limit depth
agent-browser snapshot -s "#main"     # Scope to selector
agent-browser snapshot -i --json      # Machine-readable output

agent-browser get text <sel>          # Get text content
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title
agent-browser get value <sel>         # Get input value
agent-browser get count <sel>         # Count matching elements

agent-browser is visible <sel>        # Check visibility
agent-browser is enabled <sel>        # Check if enabled
```

### Evidence Capture
For deterministic, low-token runs, prefer snapshot-only evidence and capture screenshots only on failure or when explicitly requested.

```bash
agent-browser screenshot [path]       # Screenshot (temp dir if no path)
agent-browser screenshot --full       # Full page screenshot
agent-browser console                 # View console messages (log, error, warn)
agent-browser errors                  # View uncaught JS exceptions
agent-browser trace start [path]      # Start recording trace
agent-browser trace stop [path]       # Stop and save trace
```

### Semantic Locators
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "test@test.com"
agent-browser find testid <id> <action> [value]
agent-browser find first <sel> <action>
```

### Wait
```bash
agent-browser wait <selector>           # Wait for element visible
agent-browser wait <ms>                 # Wait for time
agent-browser wait --text "Welcome"     # Wait for text
agent-browser wait --url "**/dash"      # Wait for URL pattern
agent-browser wait --load domcontentloaded  # Wait for load state
```

### Auth & State
```bash
agent-browser state save <path>        # Save auth state (cookies, storage)
agent-browser state load <path>        # Load auth state
agent-browser cookies                  # Get all cookies
agent-browser storage local            # Get all localStorage
agent-browser set headers <json>       # Set HTTP headers (origin-scoped)
```

### Sessions & Profiles
```bash
agent-browser --session agent1 open <url>   # Isolated session
agent-browser --profile ~/.myapp open <url> # Persistent profile (survives restarts)
agent-browser session list                   # List active sessions
```

## Selector Priority
1. **Refs** (`@e1`, `@e2`) — from snapshot, deterministic
2. **data-testid** — `agent-browser find testid "login-email-input" click`
3. **ARIA role** — `agent-browser find role button click --name "Submit"`
4. **Text** — `agent-browser find text "Sign In" click`
5. **CSS** — `agent-browser click "#submit"` (last resort)

## Flags Reference
| Flag | Purpose |
|------|---------|
| `--ignore-https-errors` | Accept self-signed certs (needed for Aspire) |
| `--headed` | Show browser window (default: headless) |
| `--json` | Machine-readable JSON output |
| `--full` | Full page screenshot |
| `--session <name>` | Isolated browser session |
| `--profile <path>` | Persistent browser profile |

## Architecture
- **Rust CLI** (fast native binary) → Node.js daemon → Playwright browser
- Daemon persists between commands for fast subsequent operations
- Falls back to pure Node.js if native binary unavailable
- Windows x64 supported with native Rust binary

## Critical Gotchas for SAASTools

### Self-Signed Certs
Aspire uses self-signed HTTPS certs. Always use `--ignore-https-errors`.

### Firebase Auth
Firebase stores auth in IndexedDB, not localStorage. Use `--profile` to persist
login sessions across browser restarts, or use `--headers` with test auth headers
(`X-Test-UserId`, `X-Test-TenantId`, `X-Test-Role`) when `ALLOW_TEST_AUTH=true`.

### SignalR / SSE
Don't use `--load networkidle` — SignalR connections keep the network busy.
Use `--load domcontentloaded` or `wait --text "..."` instead.

### Deep Links
Navigate to workspace features via deep links, not direct URLs:
```bash
agent-browser open "http://localhost:5173/workspace?ws=eyJhY3RpdmVWaWV3Ijoid29ya2Zsb3dzIn0"
```

## Anti-Patterns
- ❌ Don't run `agent-browser` and Playwright tests simultaneously (port conflicts)
- ❌ Don't use `wait --load networkidle` with SignalR apps
- ❌ Don't skip `--ignore-https-errors` with Aspire-hosted apps
- ❌ Don't create `.js` test scripts — agent-browser is CLI-driven, not script-driven
- ❌ Don't take screenshots at every step unless investigating a failure — follow the screenshot policy in `e2e.config.md`
