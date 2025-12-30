# Project Architecture
---
description: "High-level architecture overview for AI agents."
version: "1.0"
last-updated: "YYYY-MM-DD"
---

> **Purpose**: This file gives AI agents quick context about your project structure.
> Keep it updated as architecture evolves. Agents read this before making changes.

## Overview
*One paragraph describing what this project does and its primary purpose.*

<!-- Example:
A SaaS platform for invoice management. Users can create, send, and track invoices.
Built with .NET Aspire for orchestration, React frontend, and PostgreSQL with Marten for event sourcing.
-->

---

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|------------|---------|-------|
| Frontend | | | |
| Backend | | | |
| Database | | | |
| Cache | | | |
| Message Bus | | | |
| Auth | | | |
| Hosting | | | |

---

## Solution Structure

```
/src
├── ProjectName.AppHost/        # .NET Aspire orchestration
├── ProjectName.Api/            # Main API
├── ProjectName.Web/            # Frontend
├── ProjectName.Domain/         # Domain models & events
├── ProjectName.Infrastructure/ # Data access, external services
└── ProjectName.Tests/          # Test projects
```

*Adjust the above to match your actual structure.*

---

## Key Components

### Component 1: [Name]
- **Responsibility**: 
- **Location**: 
- **Dependencies**: 

### Component 2: [Name]
- **Responsibility**: 
- **Location**: 
- **Dependencies**: 

---

## Data Flow

```
[User] → [Frontend] → [API Gateway] → [Service] → [Database]
                                   ↓
                            [Event Bus] → [Background Workers]
```

*Replace with your actual data flow.*

---

## External Dependencies

| Service | Purpose | Docs |
|---------|---------|------|
| | | |

---

## Authentication & Authorization
*Describe auth flow: Firebase, Auth0, custom JWT, etc.*

---

## Key Patterns
*Important patterns used in this codebase that agents should follow.*

- **CQRS**: Commands vs Queries separation using [Wolverine/MediatR/etc.]
- **Event Sourcing**: Using [Marten/EventStore/etc.]
- **Repository Pattern**: [Yes/No - describe if yes]

---

## Deployment
*How the app is deployed: Azure, AWS, Docker, Kubernetes, etc.*

---

## Important Boundaries
*Things agents should NOT do without explicit approval.*

- [ ] Do not modify auth configuration
- [ ] Do not change database schema without migration
- [ ] Do not add new external dependencies without approval

---

## Related Files
- [project.patterns.md](contexts/project.patterns.md) - Coding conventions
- [warnings.md](warnings.md) - Active risks and warnings
- [project.memory.md](contexts/project.memory.md) - Lessons learned
