---
name: stack-detector
description: "Automatic tech stack detection and operational context classification. Scans project files to identify frameworks, libraries, infrastructure, and classify projects as api, desktop, frontend, infra, or unknown. Use this when asked to detect stack, identify technologies, discover frameworks, determine which skills apply, or classify a project's operational context. Triggers on: detect stack, identify tech, framework detection, stack analysis, which skills, target context, operational context."
metadata: {"aliasKeys":["target-context-detector"],"frameworks":["angular","aspire","orleans","react","signalr","vue"],"languages":["csharp","go","javascript","python","typescript"],"stacks":["api","desktop","frontend","infra"],"tags":["classification","detection","routing","targeting"]}
---

# Stack Detection Skill

## Purpose
Automatically detect frameworks, libraries, and infrastructure from project files, return the relevant skill names that exist in installed Copilot skill paths (`~/.copilot/skills-vault/` for on-demand skills and `~/.copilot/skills/` for always-loaded skills), and classify each project's operational context (api, desktop, frontend, infra, or unknown).

## When NOT to Use
- When the user explicitly specifies which technologies to use
- When only code review or general guidance is needed (use `code-review`, `csharp-expert`, etc.)

## Detection Process

### Step 1: Scan for Project Files
Look for these files in the workspace:
- `*.csproj` - .NET project files
- `*.sln` - .NET solution files
- `package.json` - Node.js/frontend projects
- `pyproject.toml`, `requirements*.txt` - Python projects
- `go.mod` - Go projects
- `*.tf` - Terraform infrastructure
- `docker-compose*.yml` - Docker Compose configuration

### Step 2: Extract Package References

**For `.csproj` files:**
```xml
<PackageReference Include="PackageName" Version="x.y.z" />
```

**For `package.json`:**
```json
{
  "dependencies": { "package-name": "^x.y.z" },
  "devDependencies": { "package-name": "^x.y.z" }
}
```

**For `pyproject.toml` / `requirements*.txt`:**
- Extract package names from dependency lists and requirements entries.

**For `go.mod`:**
- Extract module paths from `require` blocks and direct `require` lines.

### Step 3: Match Against Detection Rules

## Detection Rules

### .NET Packages (from `.csproj`)

| Package Pattern | Detected Skills |
|-----------------|-----------------|
| `Marten` | `marten-documents`, `marten-events`, `marten-linq-querying` |
| `WolverineFx` | `wolverine-core` |
| `WolverineFx.Http` | `wolverine-http` |
| `Microsoft.Orleans.*` | `orleans` |
| `Microsoft.AspNetCore.SignalR*` | `signalr` |
| `Aspire.Hosting*` | `aspire-apphost`, `aspire-deployment`, `alba-integration-tests` |
| `Alba` | `alba-integration-tests` |
| `Aspire.*` | `aspire-apphost`, `aspire-deployment` |
| `FirebaseAdmin` | `firebase-auth` |
| `Microsoft.SemanticKernel*` | `microsoft-agent-framework` |
| `Microsoft.Agents*` | `microsoft-agent-framework` |
| `Azure.AI.OpenAI`, `OpenAI` | `openai-compatible` |
| `OpenTelemetry*` | `logging-observability` |
| `NSubstitute`, `xunit`, `Shouldly` | `testing-dotnet-unit` |

### Node.js Packages (from `package.json`)

| Package Pattern | Detected Skills |
|-----------------|-----------------|
| `@tanstack/react-query` | `react-query` |
| `firebase`, `firebase-admin` | `firebase-auth` |
| `@testing-library/react`, `vitest`, `jest` | `testing-frontend-unit` |
| `react`, `vue`, `@angular/core` | `frontend` |
| `openai`, `@azure/openai`, `@azure/ai-inference` | `openai-compatible` |
| `@microsoft/agent-framework`, `@microsoft/agents`, `@microsoft/agents-*` | `microsoft-agent-framework` |

### Python Packages (from `pyproject.toml` / `requirements*.txt`)

| Package Pattern | Detected Skills |
|-----------------|-----------------|
| `openai`, `azure-ai-inference`, `azure-ai-openai` | `openai-compatible` |
| `semantic-kernel` | `microsoft-agent-framework` |

### Go Modules (from `go.mod`)

| Module Pattern | Detected Skills |
|----------------|-----------------|
| `github.com/openai/openai-go`, `github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai` | `openai-compatible` |

### Infrastructure Files

| File Pattern | Detected Skills |
|--------------|-----------------|
| `*.tf` files exist | `terraform` |
| `docker-compose*.yml` exists | `deployment-compose` |
| `config.alloy` exists | `logging-observability` |

### Secondary Signals (Namespace/Import Patterns)

If package detection is inconclusive, scan source files for:

| Pattern in Code | Detected Skills |
|-----------------|-----------------|
| `using Marten;` | `marten-documents` |
| `using Wolverine;` | `wolverine-core` |
| `using Orleans;` | `orleans` |
| `using Microsoft.AspNetCore.SignalR;` | `signalr` |
| `using Microsoft.Agents` | `microsoft-agent-framework` |
| `using Azure.AI.OpenAI;`, `using OpenAI;` | `openai-compatible` |
| `import { useQuery }` | `react-query` |
| `import OpenAI from 'openai'` | `openai-compatible` |
| `from openai import OpenAI` | `openai-compatible` |

### Step 4: Classify Operational Context

After skill detection, classify each project (or workspace root) into an operational context using these signals in priority order. Stop at the first match:

| P | Signal | Detection | Classification |
|---|--------|-----------|---------------|
| 1 | `*.tf` files present | Glob for `*.tf` in workspace | infra |
| 2 | Compose-only (no app source code) | `docker-compose*.yml` exists AND no `.csproj`, `package.json`, or app source files alongside | infra |
| 3 | .csproj with WinExe/WPF/WinForms/MAUI OutputType | Parse `<OutputType>` or `<Sdk>` in `.csproj` for `WinExe`, `Microsoft.NET.Sdk.Maui`, WPF/WinForms properties | desktop |
| 4 | Aspire.Hosting* package | `PackageReference` match for `Aspire.Hosting*` | api |
| 5 | Microsoft.NET.Sdk.Web SDK | `<Project Sdk="Microsoft.NET.Sdk.Web">` in `.csproj` | api |
| 6 | Frontend-only (react/vue/angular, no backend) | `package.json` has `react`, `vue`, or `@angular/core` in deps AND no `express`, `fastify`, `koa`, `next`, or `hono` | frontend |
| 7 | Backend Node.js framework | `package.json` has `express`, `fastify`, `koa`, `next`, or `hono` in deps | api |
| 8 | Fallback | No signals matched | unknown |

#### Multi-Project Workspaces
- Classify each project root independently.
- If workspace contains multiple projects with different contexts, list all in the output.
- A workspace with both `api` and `frontend` projects reports both — do NOT merge to a single classification.

#### Classification Stability
- Classification is deterministic: same project files → same classification.
- Signal 2 (compose-only) requires explicit absence of app source code — if ANY `.csproj` or `package.json` exists alongside compose files, skip this signal.
- Signal 6 explicitly excludes `next` (Next.js) — projects with `next` in deps match Signal 7 (api) instead.

## Output Format

Return a deduplicated list of skill names that exist in installed Copilot skill paths, followed by an optional Target Context classification:

```text
Detected Skills:
- <skill-a>
- <skill-b>
- <skill-c>
- deployment-compose

Target Context:
- api
```

### Multi-Project Format
When a workspace contains multiple projects with different contexts:

```text
Detected Skills:
- terraform
- deployment-compose
- <skill-a>
- <skill-b>

Target Context:
- infra (terraform/)
- api (src/Backend/)
- frontend (src/Frontend/)
```

### Omission Rule
Omit the `Target Context:` section entirely when all projects classify as `unknown`. Absence of the section means `unknown` (backward-compatible with consumers that do not expect it).

## Usage Example

When an agent needs to understand a codebase:

1. **Invoke this skill** to detect the stack
2. **Load detected skills** using their `SKILL.md` files
3. **Apply specialized knowledge** from those skills
4. **Use Target Context** to scope decisions (e.g., skip desktop patterns for an api project)

```text
Agent: "I need to understand this codebase"
→ Run stack-detector
→ Detects: <skill-a>, <skill-b>, <skill-c>
→ Target Context: api
→ Agent loads those 3 skills for specialized guidance
→ Agent knows this is an API project (not desktop/infra/frontend)
```

## Verification

After detection, verify skills exist:
```bash
# List always-loaded skills
ls ~/.copilot/skills/

# List on-demand skills
ls ~/.copilot/skills-vault/

# Confirm detected on-demand skill exists
test -f "$HOME/.copilot/skills-vault/wolverine-core/SKILL.md" && echo "exists"
```

## Consumer Guardrails

Agents consuming Target Context MUST follow these rules:

1. **Optional field**: Target Context may be absent. Treat absence as `unknown` and proceed normally.
2. **Cache per repo per session**: Detect once per workspace root per session. Do not re-detect on every invocation.
3. **User override is final**: If the user explicitly states the project type (e.g., "this is a desktop app"), that overrides any detected context.
4. **Never prompt unprompted**: Do not ask the user to confirm or clarify the detected context. Use it silently for scoping decisions.
5. **Deterministic fallback**: When no signals match, emit `unknown`. Never guess or infer from file names alone.

## Notes

- **Deduplicate**: Same skill may be detected from multiple signals
- **Prioritize explicit packages**: Package references are more reliable than namespace patterns
- **Return only existing skills**: Filter out any detected names that don't have a corresponding skill directory
