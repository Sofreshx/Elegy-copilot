---
name: stack-detector
description: "Automatic tech stack detection. Scans project files to identify frameworks, libraries, and infrastructure. Use this when asked to detect stack, identify technologies, discover frameworks, or determine which skills apply to a codebase. Triggers on: detect stack, identify tech, framework detection, stack analysis, which skills."
---

# Stack Detection Skill

## Purpose
Automatically detect frameworks, libraries, and infrastructure from project files and return the relevant skill names that exist in `.github/skills/`.

## When NOT to Use
- When the user explicitly specifies which technologies to use
- When only code review or general guidance is needed (use `code-review`, `csharp-expert`, etc.)

## Detection Process

### Step 1: Scan for Project Files
Look for these files in the workspace:
- `*.csproj` - .NET project files
- `*.sln` - .NET solution files
- `package.json` - Node.js/frontend projects
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
| `Aspire.Hosting*` | `aspire-apphost`, `aspire-deployment`, `aspire-integration-tests` |
| `Aspire.*` | `aspire-apphost`, `aspire-deployment` |
| `FirebaseAdmin` | `firebase-auth` |
| `Microsoft.SemanticKernel*` | `semantic-kernel-agents` |
| `OpenTelemetry*` | `logging-observability` |
| `NSubstitute`, `xunit`, `Shouldly` | `testing-dotnet-unit` |

### Node.js Packages (from `package.json`)

| Package Pattern | Detected Skills |
|-----------------|-----------------|
| `@tanstack/react-query` | `react-query` |
| `firebase`, `firebase-admin` | `firebase-auth` |
| `@testing-library/react`, `vitest`, `jest` | `testing-frontend-unit` |
| `react`, `vue`, `@angular/core` | `frontend` |
| `openai` | `openai-compatible` |

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
| `import { useQuery }` | `react-query` |

## Output Format

Return a deduplicated list of skill names that exist in `.github/skills/`:

```text
Detected Skills:
- wolverine-core
- wolverine-http
- marten-documents
- marten-events
- marten-linq-querying
- aspire-apphost
- firebase-auth
- react-query
- deployment-compose
```

## Usage Example

When an agent needs to understand a codebase:

1. **Invoke this skill** to detect the stack
2. **Load detected skills** using their `SKILL.md` files
3. **Apply specialized knowledge** from those skills

```text
Agent: "I need to understand this codebase"
→ Run stack-detector
→ Detects: wolverine-core, marten-documents, aspire-apphost
→ Agent loads those 3 skills for specialized guidance
```

## Verification

After detection, verify skills exist:
```bash
# List available skills
ls .github/skills/

# Confirm detected skill exists
test -f ".github/skills/wolverine-core/SKILL.md" && echo "exists"
```

## Notes

- **Deduplicate**: Same skill may be detected from multiple signals
- **Prioritize explicit packages**: Package references are more reliable than namespace patterns
- **Return only existing skills**: Filter out any detected names that don't have a corresponding skill directory
