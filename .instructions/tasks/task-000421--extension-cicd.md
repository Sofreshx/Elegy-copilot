---
schema: task/v1
id: task-000421
title: "GitHub Actions CI/CD for extension build/package"
type: chore
status: done
priority: high
owner: "lolzi"
skills: ["terraform"]
depends_on: ["task-000399"]
next_tasks: ["task-000422"]
created: "2026-02-01"
updated: "2026-02-02"
---

## Context

Build, test, package extension on push. Generate .vsix artifact. Publish to releases.

Set up automated CI/CD pipeline for the VS Code extension to ensure consistent builds, automated testing, and streamlined releases.

## Acceptance Criteria

- [x] .github/workflows/extension-ci.yml created
- [x] Build on PR and main branch
- [x] Test runner integration
- [x] .vsix artifact uploaded
- [x] Release draft created on tag

## Plan / Approach

1. Create GitHub Actions workflow file
2. Configure build steps for TypeScript/extension
3. Integrate test execution
4. Add artifact generation for .vsix file
5. Set up release automation on tags

## Attempts / Log

### Attempt 1 - Success
Created `.github/workflows/extension-ci.yml` with:
- `build` job: Checkout, Node 20 setup, npm ci, lint, compile, test, package .vsix, upload artifact
- `release` job: Downloads artifact, creates draft release with auto-generated notes on version tags (v*)
- `mobile-build` job: Builds PWA on main/tags, uploads dist as artifact
- Triggered on push to main, tags starting with v*, and PRs touching extension files

## Failures

None.

## Notes / Discoveries

- Used @vscode/vsce for packaging
- Draft releases allow manual review before publishing
- Mobile PWA build included for completeness

## Next Steps

Continue to task-000422 (Marketplace publishing)
