# Skill Generation Queue
---
description: "Queue of documentation sources to process into skills. Each entry is a starting point for crawling."
---

## ✅ Completed Skills

### 1. Wolverine - Message Bus & HTTP Endpoints
- **Status**: `completed`
- **Priority**: High
- **Generated**:
  - `wolverine.core.agent.md` - Core concepts, message handling, handlers
  - `wolverine.http.agent.md` - HTTP endpoints, routing, parameter binding

### 2. Marten - Document DB & Event Sourcing
- **Status**: `completed` (documents only)
- **Priority**: High
- **Generated**:
  - `marten.documents.agent.md` - Document storage, sessions, querying
- **Pending**: `marten.events.agent.md` - Event sourcing, projections

### 4. .NET Aspire - General
- **Status**: `completed`
- **Priority**: High
- **Generated**:
  - `aspire.apphost.agent.md` - AppHost orchestration, resources, configuration

### 5. .NET Aspire - Deployment
- **Status**: `completed`
- **Priority**: High
- **Generated**:
  - `aspire.deployment.agent.md` - Publishing, deployment, Docker Compose, K8s

### 6. Firebase Auth
- **Status**: `completed` (existing enhanced)
- **Priority**: High
- **Existing**: `firebase.auth.agent.md` - Admin SDK, custom claims, token verification

### 7. Cloudflare API
- **Status**: `completed`
- **Priority**: Medium
- **Generated**:
  - `cloudflare.storage.agent.md` - R2, Workers KV, Images API

### 8. Orleans - Virtual Actors
- **Status**: `completed`
- **Priority**: Medium
- **Generated**: `orleans.agent.md` - Grains, silos, persistence, timers, reminders

### 9. SignalR - Real-time Communication
- **Status**: `completed`
- **Priority**: Medium
- **Generated**: `signalr.agent.md` - Hubs, clients, groups, strongly-typed hubs

### 10. Marten Event Sourcing
- **Status**: `completed`
- **Priority**: Medium
- **Generated**: `marten.events.agent.md` - Event streams, projections, aggregates

### 11. Microsoft Agent Framework (Semantic Kernel)
- **Status**: `completed`
- **Priority**: Medium
- **Generated**: `semantic-kernel.agents.agent.md` - ChatCompletionAgent, OpenAI Assistant, plugins, orchestration

## 📋 Pending Skills

*Queue is empty - all skills have been generated!*

---

## 🔄 Processing Instructions

### Crawl Strategy
When processing an entry point:
1. **Fetch Entry Page**: Get the main content.
2. **Discover Sub-pages**: Find navigation links (sidebar, "Next" buttons, sub-sections).
3. **Prioritize**:
   - "Getting Started" / "Basics" → Core skill
   - "API Reference" → Cheat sheet section
   - "Best Practices" / "Patterns" → Guidelines section
   - "Troubleshooting" → Gotchas section
4. **Depth Limit**: Max 3 levels deep from entry point.
5. **Store Sources**: Keep all crawled URLs in the generated skill's metadata.

### Output Format
Each generated skill should include:
```markdown
# Skill: [Library] - [Focus]
---
sources:
  - [URL 1]
  - [URL 2]
last_processed: YYYY-MM-DD
---

## 🧠 Knowledge (Cheat Sheet)
...

## 💡 Best Practices
...

## ⚠️ Gotchas
...
```

---

## ✅ Completed Skills
| Skill | Date | Sources |
|-------|------|---------|
<!-- Completed skills will be moved here -->
