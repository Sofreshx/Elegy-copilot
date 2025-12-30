# Skill Index
> **Purpose**: Master registry of all global skills. Enables discovery, routing, and lazy-loading.

## How to Use This Index
1. **Executives**: Query this index to find the right skill for a task.
2. **Lazy Loading**: Only load skills when `required: true` or explicitly invoked.
3. **Local Override**: If `.instructions/skills/[skill-name].agent.md` exists, prefer it.
4. **Project Index**: Check `.instructions/project.index.md` for project-specific skill activation.

---

## Skill Categories

### 🏗️ Core Development
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Feature Creator | `feature.creator.agent.md` | "add endpoint", "create feature", "backend" | Backend, APIs, CRUD |
| Frontend | `frontend.agent.md` | "UI", "component", "React", "Vue", "page" | React, Vue, Angular |
| Refactor | `refactor.agent.md` | "refactor", "clean up", "reorganize" | Code restructuring |
| Migration | `migration.agent.md` | "migrate", "upgrade version", "move to" | Version upgrades, migrations |

### 🔐 Auth & Security
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Auth | `auth.agent.md` | "authentication", "login", "JWT", "OIDC" | Generic auth patterns |
| Firebase Auth | `firebase.auth.agent.md` | "Firebase", "Firebase Auth", "admin SDK" | Firebase Admin SDK (.NET) |
| Security | `security.agent.md` | "security", "vulnerability", "hardening" | Security patterns |
| Secrets Auditor | `secrets.auditor.agent.md` | "secrets", "credentials", "leaked" | Secret detection |

### 🧪 Quality & Testing
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Testing | `testing.agent.md` | "test", "unit test", "integration test" | All test types |
| Code Review | `code-review.agent.md` | "review", "PR review", "code quality" | Code review |
| Quality Auditor | `quality.auditor.agent.md` | "audit quality", "code smell" | Quality metrics |
| Quality C# | `quality.csharp.agent.md` | "C# quality", "Roslyn", ".NET patterns" | C#-specific quality |
| Quality TypeScript | `quality.ts.agent.md` | "TS quality", "ESLint", "TypeScript patterns" | TS-specific quality |
| Performance | `performance.agent.md` | "performance", "optimize", "slow" | Performance tuning |

### 🐛 Debug & Diagnostics
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Debug | `debug.agent.md` | "debug", "breakpoint", "trace", "investigate", "why failing", "error" | Debugging & Error investigation |

### ☁️ Infrastructure & DevOps
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Terraform | `terraform.agent.md` | "terraform", "infrastructure", "IaC" | Terraform IaC |
| Deployment Compose | `deployment.compose.agent.md` | "docker", "compose", "container" | Docker Compose |
| Cloudflare Storage | `cloudflare.storage.agent.md` | "R2", "Cloudflare", "storage" | Cloudflare R2 |

### 🔷 .NET Aspire
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Aspire AppHost | `aspire.apphost.agent.md` | "AppHost", "Aspire orchestration" | .NET Aspire hosting |
| Aspire Deployment | `aspire.deployment.agent.md` | "Aspire deploy", "AZD" | Aspire deployment |
| Aspire Integration Tests | `aspire.tests.integration.agent.md` | "Aspire test", "integration test Aspire" | Aspire testing |

### 📦 Libraries & Frameworks
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Wolverine Core | `wolverine.core.agent.md` | "Wolverine", "message handler", "CQRS" | Wolverine messaging |
| Wolverine HTTP | `wolverine.http.agent.md` | "Wolverine endpoint", "Wolverine API" | Wolverine HTTP |
| Marten Documents | `marten.documents.agent.md` | "Marten", "document store" | Marten document DB |
| Marten Events | `marten.events.agent.md` | "event sourcing", "Marten events" | Marten event sourcing |
| Orleans | `orleans.agent.md` | "Orleans", "grain", "virtual actor" | Microsoft Orleans |
| SignalR | `signalr.agent.md` | "SignalR", "real-time", "websocket" | SignalR real-time |
| Semantic Kernel | `semantic-kernel.agents.agent.md` | "Semantic Kernel", "SK agents" | MS Semantic Kernel |
| MS Agent Framework | `microsoft.agent.framework.agent.md` | "Agent Framework", "MS agents" | MS Agent Framework |
| OpenAI API | `openai.api.agent.md` | "OpenAI", "GPT", "chat completion" | OpenAI integration |

### 📝 Documentation & Design
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| Docs | `docs.agent.md` | "documentation", "README", "docs" | Documentation |
| Design | `design.agent.md` | "design", "architecture", "diagram" | System design |

### ⚙️ System (Internal)
| Skill | File | Triggers | Domain |
|-------|------|----------|--------|
| System Editor | `system.editor.agent.md` | (internal) | Edit instruction files |
| System Cleanup | `system.cleanup.agent.md` | (internal) | Archive completed tasks |
| System Drift | `system.drift.agent.md` | (internal) | Fix pattern drift |
| System Health | `system.health.agent.md` | (internal) | Verify system integrity |
| System Upgrade | `system.upgrade.agent.md` | (internal) | Upgrade engine files |

---

## Skill Resolution Algorithm

```
1. Parse user request for keywords
2. Match against "Triggers" column
3. If multiple matches:
   a. Prefer more specific skill (firebase.auth > auth)
   b. Consider project stack context
4. Check `.instructions/project.index.md` for overrides
5. Check `.instructions/skills/` for local version
6. Load skill from this index
```

## Adding New Skills

1. Create `[name].agent.md` in `skills/` folder
2. Add entry to appropriate category table above
3. Include meaningful triggers for discovery
4. Follow schema-version "1.0" format

---

## Version
- **Last Updated**: 2025-12-30
- **Skill Count**: 37
