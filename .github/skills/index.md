# Skill Index
> **Purpose**: Master registry of all global skills. Enables discovery, routing, and lazy-loading.
> **Note**: Executive agents are in `.github/agents/`, not here.
> **Format**: All skills follow the [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) specification.

## Skill File Format

Each skill has a `SKILL.md` file with:
```yaml
---
name: skill-name          # Required: lowercase, hyphens for spaces
description: "..."        # Required: what it does + "Use this when..."
---
```

**Note**: The `tools`, `sources`, and `schema-version` fields are NOT part of the GitHub spec and have been removed.

## How to Use This Index
1. **Auto-Discovery**: Copilot loads skills based on `description` matching user requests.
2. **Local Override**: If `.instructions/skills/[skill-name]/SKILL.md` exists, prefer it.
3. **Project Index**: Check `.instructions/project.index.md` for project-specific skill activation.

---

## Skill Categories

### 🏗️ Core Development
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Feature Creator | `feature-creator/` | "add endpoint", "create feature", "backend" | Backend, APIs, CRUD |
| Frontend | `frontend/` | "UI", "component", "React", "Vue", "page" | React, Vue, Angular |
| Refactor | `refactor/` | "refactor", "clean up", "reorganize" | Code restructuring |
| Migration | `migration/` | "migrate", "upgrade version", "move to" | Version upgrades, migrations |

### 🔐 Auth & Security
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Auth | `auth/` | "authentication", "login", "JWT", "OIDC" | Generic auth patterns |
| Firebase Auth | `firebase-auth/` | "Firebase", "Firebase Auth", "admin SDK" | Firebase Admin SDK (.NET) |
| Security | `security/` | "security", "vulnerability", "hardening" | Security patterns |
| Secrets Auditor | `secrets-auditor/` | "secrets", "credentials", "leaked" | Secret detection |

### 🧪 Quality & Testing
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Testing | `testing/` | "test", "unit test", "integration test" | All test types |
| Aspire Integration Tests | `aspire-integration-tests/` | "Aspire test", "integration test Aspire" | Aspire testing |
| Code Review | `code-review/` | "review", "PR review", "code quality" | Code review |
| Quality Auditor | `quality-auditor/` | "audit quality", "code smell" | Quality metrics |
| Quality C# | `quality-csharp/` | "C# quality", "Roslyn", ".NET patterns" | C#-specific quality |
| Quality TypeScript | `quality-typescript/` | "TS quality", "ESLint", "TypeScript patterns" | TS-specific quality |
| Performance | `performance/` | "performance", "optimize", "slow" | Performance tuning |

### 🐛 Debug & Diagnostics
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Debug | `debug/` | "debug", "breakpoint", "trace", "investigate", "why failing", "error" | Debugging & Error investigation |
| General Debugger | `general-debugger/` | "general debug", "standard debugging" | General debugging strategies |

### ☁️ Infrastructure & DevOps
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Terraform | `terraform/` | "terraform", "infrastructure", "IaC" | Terraform IaC |
| Deployment Compose | `deployment-compose/` | "docker", "compose", "container" | Docker Compose |
| Cloudflare Storage | `cloudflare-storage/` | "R2", "Cloudflare", "storage" | Cloudflare R2 |

### 🔷 .NET Aspire
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Aspire AppHost | `aspire-apphost/` | "AppHost", "Aspire orchestration" | .NET Aspire hosting |
| Aspire Deployment | `aspire-deployment/` | "Aspire deploy", "AZD" | Aspire deployment |

### 📦 Libraries & Frameworks
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Wolverine Core | `wolverine-core/` | "Wolverine", "message handler", "CQRS" | Wolverine messaging |
| Wolverine HTTP | `wolverine-http/` | "Wolverine endpoint", "Wolverine API" | Wolverine HTTP |
| Marten Documents | `marten-documents/` | "Marten", "document store" | Marten document DB |
| Marten Events | `marten-events/` | "event sourcing", "Marten events" | Marten event sourcing |
| Orleans | `orleans/` | "Orleans", "grain", "virtual actor" | Microsoft Orleans |
| SignalR | `signalr/` | "SignalR", "real-time", "websocket" | SignalR real-time |
| Semantic Kernel Agents | `semantic-kernel-agents/` | "Semantic Kernel", "SK agents" | MS Semantic Kernel |
| MS Agent Framework | `ms-agent-framework/` | "Agent Framework", "MS agents" | MS Agent Framework |
| OpenAI API | `openai-api/` | "OpenAI", "GPT", "chat completion" | OpenAI integration |

### 📝 Documentation & Design
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| Docs | `docs/` | "documentation", "README", "docs" | Documentation |
| Design | `design/` | "design", "architecture", "diagram" | System design |

### ⚙️ System (Internal)
| Skill | Folder | Triggers | Domain |
|-------|--------|----------|--------|
| System Editor | `system-editor/` | (internal) | Edit instruction files |
| System Cleanup | `system-cleanup/` | (internal) | Archive completed tasks |
| System Drift | `system-drift/` | (internal) | Fix pattern drift |
| System Health | `system-health/` | (internal) | Verify system integrity |
| System Upgrade | `system-upgrade/` | (internal) | Upgrade engine files |

---

## Skill Resolution Algorithm

```
1. Parse user request for keywords
2. Match against "Triggers" column
3. If multiple matches:
   a. Prefer more specific skill (firebase-auth > auth)
   b. Consider project stack context
4. Check `.instructions/project.index.md` for overrides
5. Check `.instructions/skills/` for local version
6. Load skill from `instruction-engine/.github/skills/[folder]/SKILL.md`
```

## Adding New Skills

1. Create `skills/[skill-name]/` folder
2. Add `SKILL.md` with YAML frontmatter
3. Add entry to appropriate category table above
4. Include meaningful triggers for discovery

---

## Version
- **Last Updated**: 2025-12-31
- **Skill Count**: 38 (executive agents are in `/agents/`)
