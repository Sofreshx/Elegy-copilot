# Task: Create API Dockerfile

## Goal
Create a production Dockerfile for the QuestFlow.Api .NET 10 backend.

## Acceptance Criteria
- [ ] Dockerfile uses multi-stage build (restore, build, publish, runtime)
- [ ] Base image is `mcr.microsoft.com/dotnet/aspnet:10.0`
- [ ] SDK image is `mcr.microsoft.com/dotnet/sdk:10.0`
- [ ] Exposes port 8080
- [ ] Copies all backend projects (Api, Domain, Infrastructure)
- [ ] Uses `--no-restore` where appropriate for caching

## Context
- Project file: `Backend/QuestFlow.Api/QuestFlow.Api.csproj`
- References: `QuestFlow.Domain`, `QuestFlow.Infrastructure`
- Target framework: net10.0

## Output
- `Backend/QuestFlow.Api/Dockerfile`

## Validation
- `docker build -t questflow-api -f Backend/QuestFlow.Api/Dockerfile .` succeeds from repo root

## Status
pending
