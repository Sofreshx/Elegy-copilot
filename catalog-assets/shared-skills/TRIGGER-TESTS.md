# Trigger Tests — Shared Skills Catalog

## agents-md-authoring
### Should Trigger
- "Create an AGENTS.md file for this repo"
- "Write a CLAUDE.md with our conventions"
- "Audit which instruction files the agent loads"
### Should Not Trigger
- "How do I write good code?"
- "Add a comment to this function"
- "What does git status do?"

## codebase-design
### Should Trigger
- "Design a deep module for the payment processor"
- "Where should I put the seam between auth and billing?"
- "This module is too shallow — deepen the interface"
### Should Not Trigger
- "Fix this typo in the README"
- "Add a unit test for the helper function"
- "What time is the deployment scheduled?"

## diagnosing-bugs
### Should Trigger
- "Diagnose why the checkout flow is broken"
- "Debug the failing API gateway — it returns 500 sporadically"
- "Find the cause of this performance regression in the search endpoint"
### Should Not Trigger
- "Write a new feature for user profiles"
- "Explain the architecture to me"
- "What's the latest version of Node?"

## docs-practice
### Should Trigger
- "Fix the README — it's missing the quick start section"
- "Audit docs for missing ADR format compliance"
- "Check the documentation structure against our standards"
### Should Not Trigger
- "Deploy the app to production"
- "Refactor the authentication module"
- "How do I use the Stripe API?"

## domain-modeling
### Should Trigger
- "Build a domain model for the order fulfillment system"
- "Define the ubiquitous language for our inventory domain"
- "Record an architectural decision about event sourcing vs CRUD"
### Should Not Trigger
- "Add a CSS class to the navigation bar"
- "Run the integration tests"
- "What's the weather like?"

## elegy-obsidian
### Should Trigger
- "Search my Obsidian vault for notes tagged 'architecture'"
- "Create a daily note in my vault"
- "Find tasks in my vault that are overdue"
### Should Not Trigger
- "Write a unit test for this function"
- "Review this pull request"
- "Convert this Python script to TypeScript"

## elegy-planning
### Should Trigger
- "Create a goal for the authentication migration"
- "Show me the roadmap for the billing v2 project"
- "List all work points in the current plan"
### Should Not Trigger
- "Add a comment to the CSS file"
- "What is the git log for this branch?"
- "Compile the Rust backend"

## elegy-skills-discovery
### Should Trigger
- "Search for skills related to testing"
- "Resolve which skill handles code review"
- "Validate the skills in the catalog"
### Should Not Trigger
- "Run the test suite"
- "Add a new API endpoint"
- "What's the current branch name?"

## grilling
### Should Trigger
- "Grill me on the database migration plan"
- "Interview me about the new feature design before I start"
- "Stress-test the architecture decision I just made"
### Should Not Trigger
- "Write the code for the login page"
- "Deploy to staging"
- "What's the npm registry URL?"

## handoff
### Should Trigger
- "Create a handoff document — this session is full"
- "Compress the session into a handoff for the next agent"
- "Write a handoff so work can continue in a fresh session"
### Should Not Trigger
- "Implement the user registration endpoint"
- "Review the open PRs"
- "What does the CI pipeline look like?"

## implementation-handoff
### Should Trigger
- "Convert this plan into an implementation handoff brief"
- "Write an executor-ready brief for the payment integration"
- "Turn the roadmap slice into a delegation brief"
### Should Not Trigger
- "Build the component right now"
- "Run npm install"
- "How do I set up a new repo?"

## implementation-review
### Should Trigger
- "Review this implementation before handoff"
- "Check the diff for regressions and scope creep"
- "Validate the changes against the plan and acceptance criteria"
### Should Not Trigger
- "Write a new feature from scratch"
- "Create a spec for the notification system"
- "What is the git hash for HEAD?"

## improve-codebase-architecture
### Should Trigger
- "Scan the codebase for deepening opportunities"
- "Find refactoring candidates to reduce module shallowness"
- "Run a codebase health check and show me architectural friction"
### Should Not Trigger
- "Add a log line to the error handler"
- "Update the dependencies"
- "What's the server uptime?"

## prototype
### Should Trigger
- "Build a throwaway prototype to test the state machine design"
- "Prototype three different UI layouts before we commit to one"
- "Experiment with the notification delivery model — I need to see it run"
### Should Not Trigger
- "Ship the feature to production"
- "Write the final integration tests"
- "Document the API in the README"

## rubberduck-plan-review
### Should Trigger
- "Rubberduck my plan for the database migration"
- "Critique the refactoring approach before I start"
- "Stress-test the architecture decision — find weak assumptions"
### Should Not Trigger
- "Check if the server is running"
- "Add a CSS variable to the theme"
- "What files changed in the last commit?"

## skill-authoring
### Should Trigger
- "Create a new skill for managing deployment pipelines"
- "Fix this SKILL.md — it triggers at the wrong time"
- "Refine the skill description so it matches actual trigger patterns"
### Should Not Trigger
- "Optimize the database query"
- "Add a route to the Express app"
- "What's the license of this repo?"

## spec-authoring
### Should Trigger
- "Author a spec for the new payment processing feature"
- "Create a durable repo spec under docs/specs/notification-service/"
- "Refine spec.md to include missing acceptance checks"
### Should Not Trigger
- "Merge the feature branch"
- "Run the linter on the codebase"
- "How do I install Docker?"

## spec-dev
### Should Trigger
- "Use spec-driven development for the auth migration"
- "Write a spec-first design for the new search feature"
- "Route this task through spec-anchored development"
### Should Not Trigger
- "Push commits to the remote"
- "Add a favicon to the site"
- "What is the Node.js event loop?"

## spec-planning-bridge
### Should Trigger
- "Hand off the approved spec to the planning lane"
- "Bridge the spec to a roadmap in elegy-planning"
- "Link the spec to the implementation plan"
### Should Not Trigger
- "Fix a typo in the error message"
- "Add a dependency to package.json"
- "What's the default timeout for fetch?"

## spec-review
### Should Trigger
- "Review the spec for the inventory module before we plan"
- "Find requirements gaps in the spec for the new API"
- "Critique spec.md — check for missing evidence and weak acceptance checks"
### Should Not Trigger
- "Write a login form component"
- "Update the changelog"
- "How do I configure webpack?"

## tdd
### Should Trigger
- "Build this feature using TDD — red-green-refactor"
- "Write the tests first for the checkout flow"
- "Implement the search endpoint test-first"
### Should Not Trigger
- "Add a migration script for the database"
- "Review the code style guide"
- "What's the font size in the design system?"

## ui-design-spec
### Should Trigger
- "Write a UI spec for the new dashboard redesign"
- "Convert this Figma mockup into a structured UI specification"
- "Create a design spec from these screenshots of the old app"
### Should Not Trigger
- "Fix the database connection pool"
- "Run the backend unit tests"
- "What's the CI/CD pipeline configuration?"

## ui-system
### Should Trigger
- "Build a settings panel using existing components"
- "Create a new dialog following the design system tokens"
- "Add an icon to the toolbar — check if it already exists in our icon library"
### Should Not Trigger
- "Optimize the GraphQL resolver"
- "Add a cron job for email delivery"
- "What's the Redis memory usage?"

## ui-visual-review
### Should Trigger
- "Visual review of the new checkout flow — here's a screenshot"
- "Run a UI audit on the onboarding screens"
- "Check the rendered form against the design spec"
### Should Not Trigger
- "Refactor the authentication middleware"
- "Seed the database with test data"
- "How do I configure Nginx?"

## writing-great-skills
### Should Trigger
- "Evaluate the quality of this skill — does it follow best practices?"
- "Diagnose why this skill has failure modes in production"
- "Design a skill that's predictable across different models"
### Should Not Trigger
- "Deploy the Tauri app to production"
- "Add a loading spinner component"
- "What port is the dev server on?"
