---
schema: task/v1
id: task-000423
title: "Mobile app deployment"
type: chore
status: done
priority: medium
owner: "lolzi"
skills: ["terraform", "deployment-compose"]
depends_on: ["task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-02"
---

## Context

Deploy PWA to GitHub Pages. Optional Capacitor wrapper for iOS/Android stores.

Set up deployment pipeline for the mobile companion app, starting with GitHub Pages for the PWA and optionally preparing for native app store distribution.

## Acceptance Criteria

- [x] PWA deployed to GitHub Pages
- [ ] Custom domain (optional) - deferred
- [x] CI/CD for mobile builds
- [ ] Capacitor project setup (optional) - deferred

## Plan / Approach

1. Configure GitHub Pages deployment for PWA
2. Set up custom domain if needed
3. Create CI/CD workflow for automated mobile builds
4. (Optional) Initialize Capacitor project for native app stores
5. Document deployment process

## Attempts / Log

### Attempt 1 - Success
Created `.github/workflows/mobile-deploy.yml` with:
- Automated build on push to main or mobile-companion path changes
- Node 20 setup with npm caching
- Vite build with environment variable injection
- GitHub Pages deployment via actions/deploy-pages
- Concurrency control to prevent parallel deployments

Capacitor and custom domain deferred as optional.

## Failures

None.

## Notes / Discoveries

- Uses GitHub Pages artifact upload for deployment
- Environment variables (VITE_*) configured via repository variables

## Next Steps

Continue to task-000424 (Documentation)
