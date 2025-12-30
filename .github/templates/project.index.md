# Project Agent Index
---
description: "Registry of project-specific agents and skills. Controls what gets loaded."
version: "1.0"
---

> **Purpose**: This file controls which skills are active for your project.
> Only checked skills will be loaded, reducing context window usage.
> See `instruction-engine/.github/patterns/lazy-loading.pattern.md` for details.

## 📌 Active Skills
*Check the skills you need. Unchecked skills won't be loaded.*

### Core Development
- [ ] `feature.creator.agent.md` - Backend/API feature implementation
- [ ] `frontend.agent.md` - React/Vue/Angular UI development
- [ ] `refactor.agent.md` - Code refactoring
- [ ] `migration.agent.md` - Version migrations

### Auth & Security
- [ ] `auth.agent.md` - Generic authentication flows
- [ ] `firebase.auth.agent.md` - Firebase Admin SDK (.NET)
- [ ] `security.agent.md` - Security review
- [ ] `secrets.auditor.agent.md` - Secret detection

### Quality & Testing
- [ ] `testing.agent.md` - Test writing
- [ ] `code-review.agent.md` - Code review
- [ ] `quality.csharp.agent.md` - C# quality patterns
- [ ] `quality.ts.agent.md` - TypeScript quality patterns
- [ ] `performance.agent.md` - Performance optimization

### Infrastructure
- [ ] `terraform.agent.md` - Terraform IaC
- [ ] `deployment.compose.agent.md` - Docker Compose
- [ ] `cloudflare.storage.agent.md` - Cloudflare R2

### .NET Aspire
- [ ] `aspire.apphost.agent.md` - Aspire orchestration
- [ ] `aspire.deployment.agent.md` - Aspire deployment
- [ ] `aspire.tests.integration.agent.md` - Aspire integration tests

### Libraries & Frameworks
- [ ] `wolverine.core.agent.md` - Wolverine messaging
- [ ] `wolverine.http.agent.md` - Wolverine HTTP endpoints
- [ ] `marten.documents.agent.md` - Marten document store
- [ ] `marten.events.agent.md` - Marten event sourcing
- [ ] `orleans.agent.md` - Microsoft Orleans
- [ ] `signalr.agent.md` - SignalR real-time
- [ ] `semantic-kernel.agents.agent.md` - Semantic Kernel
- [ ] `openai.api.agent.md` - OpenAI API integration

### Documentation
- [ ] `docs.agent.md` - Documentation
- [ ] `design.agent.md` - System design

---

## 📂 Local Skills (`.instructions/skills/`)
*Project-specific skills created via @skill-builder. These override global skills.*

<!-- Example:
- [x] `myproject.auth.skill.md` - Custom auth flow for this project
- [x] `stripe.payments.skill.md` - Stripe integration patterns
-->

---

## 📂 Sub-Agents (`.instructions/sub-agents/`)
*Custom sub-agents specific to this project.*

<!-- Example:
- [x] `billing.agent.md` - Handles all billing-related tasks
-->

---

## 🔧 Configuration

```yaml
# Strict mode: Only use checked skills above (recommended for large projects)
strict_skill_mode: false

# Auto-load project.memory.md before every task
auto_load_memory: true

# Auto-load warnings.md before every task
auto_load_warnings: true

# Max skills to load per task (prevents context overflow)
max_concurrent_skills: 3
```

---

## 📊 Project Stack (Auto-detected)
*Filled by @onboarding during initialization.*

```yaml
detected_stacks: []
# Example:
# detected_stacks:
#   - dotnet-aspire
#   - react
#   - firebase
```

---

## Notes
- Run `@onboarding` to auto-detect your stack and populate this file
- Check skills as you need them; uncheck to reduce context usage
- Local skills in `.instructions/skills/` always take precedence
- See `instruction-engine/.github/agents/skills/index.md` for full skill list
