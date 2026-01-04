---
name: test-coverage
description: "Tools and commands for measuring code coverage (Coverlet, etc.)."
---

# Test Coverage Skill

## Purpose
Measure and report on code coverage to identify untested areas.

## Usage (.NET / Coverlet)

### 1. Install Coverlet
Ensure `coverlet.collector` is installed in test projects.

### 2. Run Coverage
```bash
dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=cobertura
```

### 3. Generate Report
Use `reportgenerator` to visualize.
```bash
dotnet reportgenerator -reports:"**/coverage.cobertura.xml" -targetdir:"coverage-report" -reporttypes:Html
```

## Analysis
- **Line Coverage**: % of lines executed.
- **Branch Coverage**: % of decision points executed (if/else).

## Integration
- Agents should use the raw XML/JSON output to parse metrics programmatically if needed, or rely on the summary printed to stdout.
