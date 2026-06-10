# Security Policy

## Supported reporting path

If you discover a security issue in Elegy Copilot:

1. Do **not** open a public GitHub issue with exploit details.
2. Prefer GitHub's private vulnerability reporting flow if it is enabled for this repository.
3. If private reporting is not available, contact the maintainers privately through GitHub before disclosing details publicly.

Include:

- affected component(s)
- impact and reproduction details
- any logs, screenshots, or proof-of-concept material needed to validate the issue
- suggested remediation if you have one

## Scope

Security-sensitive areas include:

- local dashboard/server routes in `copilot-ui/`
- packaged desktop updater/release flows
- repo and user-global asset installation under `~/.elegy`
- local-tracker gateway and messaging integrations
- workflow/release trust-chain automation

## Disclosure expectations

- We will acknowledge reports as soon as practical.
- Please allow time for investigation and remediation before public disclosure.
- Coordinated disclosure is preferred for any issue involving credentials, signing, update channels, or remote execution risk.
