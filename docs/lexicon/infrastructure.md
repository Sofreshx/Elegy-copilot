---
created: 2026-06-03
updated: 2026-06-30
category: lexicon
status: current
doc_kind: node
id: infrastructure-glossary
summary: Glossary of infrastructure, containers, and DevOps concepts.
tags: [lexicon, infrastructure, devops]
---

# Infrastructure & DevOps

## Containers

### Container
**Definition:** A lightweight, standalone, executable package that includes everything needed to run software — code, runtime, system tools, libraries, and settings.
**Usage:** Use for consistent environments across development, testing, and production. Containers share the host OS kernel, making them lighter than VMs. Distinguish from Virtual Machine (full OS, heavier, slower to start).
**Related:** Docker (container platform), Image (the package), Layer (filesystem overlay), Registry (image storage)
**Tags:** infrastructure, containers

### Docker
**Definition:** The most widely used container platform, providing tools for building, shipping, and running containers.
**Usage:** Use for local development environments, CI/CD pipelines, and production deployments. Dockerfile defines the build, Docker Compose defines multi-container setups, Docker Registry stores images.
**Related:** Container (the unit), Dockerfile (build instructions), Compose (multi-container), Registry (image storage), Docker Hub (public registry)
**Tags:** infrastructure, containers, docker

### Dockerfile
**Definition:** A script containing instructions for building a Docker image — base image, dependencies, configuration, and entrypoint.
**Usage:** Use to define reproducible container builds. Each instruction creates a layer. Best practices: use specific base images, minimize layers, use multi-stage builds for smaller images.
**Related:** Image (the build output), Layer (each instruction), Multi-stage Build (separating build from runtime), .dockerignore (exclude files)
**Tags:** infrastructure, containers, dockerfile

### Registry
**Definition:** A storage and distribution system for container images, allowing users to push, pull, and version images.
**Usage:** Use for storing and sharing images within a team or organization. Docker Hub is the default public registry. Private registries (ECR, GCR, ACR, Harbor) control access and availability.
**Related:** Image (the stored artifact), Tag (version label), Pull (download), Push (upload), Digest (content-addressable identifier)
**Tags:** infrastructure, containers, registry

### Volume
**Definition:** A persistent data storage mechanism for containers, surviving container restarts and removal.
**Usage:** Use for database data, application state, or any data that must persist across container lifecycles. Distinguish from Bind Mount (host directory mapped in) — Volumes are managed by the container runtime.
**Related:** Bind Mount (host directory), Ephemeral (container-internal, non-persistent), Named Volume (managed, named), tmpfs (in-memory)
**Tags:** infrastructure, containers, volume

## Orchestration

### Kubernetes
**Definition:** An open-source container orchestration platform for automating deployment, scaling, and management of containerized applications.
**Usage:** Use for production container deployments that need scaling, self-healing, rolling updates, and service discovery. Overkill for simple applications. Distinguish from Docker Compose (single-host, dev environments) and Nomad (alternative orchestrator).
**Related:** Pod (smallest unit), Service (network abstraction), Deployment (desired state), Cluster (node group), Helm (package manager)
**Tags:** infrastructure, orchestration, kubernetes

### Pod
**Definition:** The smallest deployable unit in Kubernetes — one or more containers that share networking and storage, typically co-located workers.
**Usage:** Use for tightly coupled containers that must share resources (a main container + sidecar). Most deployments use one container per pod. Distinguish from Container (individual runtime) — Pod is the Kubernetes deployment unit.
**Related:** Container (inside pod), Sidecar (helper container), Deployment (pod management), Node (pod host)
**Tags:** infrastructure, kubernetes, pod

### Service
**Definition:** An abstraction in Kubernetes that exposes a set of pods as a network service, providing stable DNS name and load balancing.
**Usage:** Use to enable communication between parts of an application. Pods are ephemeral (IPs change); services provide stable endpoints. Types: ClusterIP (internal), NodePort (external), LoadBalancer (cloud LB).
**Related:** Pod (the target), Ingress (external HTTP routing), Endpoint (pod IP mapping), Service Mesh (advanced traffic management)
**Tags:** infrastructure, kubernetes, service

### Ingress
**Definition:** A Kubernetes resource that exposes HTTP/HTTPS routes from outside the cluster to services within, providing host/path-based routing and TLS termination.
**Usage:** Use for external access to HTTP-based services. An ingress controller (NGINX, Traefik, HAProxy) implements the ingress rules. Distinguish from Service LoadBalancer (L4, not HTTP-aware).
**Related:** Service (backend target), Ingress Controller (implementation), TLS (ingress termination), Path-based Routing (URL dispatch)
**Tags:** infrastructure, kubernetes, ingress

### Helm
**Definition:** A package manager for Kubernetes that bundles related resources (deployments, services, configmaps) into reusable charts.
**Usage:** Use for deploying complex applications with configurable parameters. Charts version, package, and distribute Kubernetes manifests. Distinguish from Kustomize (YAML overlays, no packaging) — Helm packages and versions.
**Related:** Chart (Helm package), Values (configuration), Release (deployed instance), Template (generated manifest)
**Tags:** infrastructure, kubernetes, helm

## CI/CD

### Continuous Integration (CI)
**Definition:** A practice where developers frequently merge code changes into a shared repository, with automated builds and tests running on each change.
**Usage:** Apply to catch integration issues early. Every push triggers automated build and test. The goal is fast feedback — broken code is detected and fixed within minutes.
**Related:** Continuous Delivery (deploy to staging), Continuous Deployment (automated to production), Build Pipeline (the automation), Trunk-based Development (CI-optimized branching)
**Tags:** infrastructure, ci-cd, ci

### Continuous Delivery (CD)
**Definition:** An extension of CI where every change that passes automated tests is deployable to production, but deployment may be a manual decision.
**Usage:** Use to ensure the codebase is always in a deployable state. The release decision is a business choice, not a technical blocker. Distinguish from Continuous Deployment (automated to production, no manual gate).
**Related:** Continuous Integration (the upstream), Continuous Deployment (fully automated), Deployment Pipeline (the automation), Release (the manual gate)
**Tags:** infrastructure, ci-cd, cd

### Continuous Deployment
**Definition:** A practice where every change that passes automated tests is automatically deployed to production, with no manual gate.
**Usage:** Use for low-risk, high-frequency deployments where speed is critical. Requires strong automated testing, feature flags, and monitoring. Distinguish from Continuous Delivery (has a manual release gate).
**Related:** Continuous Delivery (manual gate), Feature Flag (disable without deploy), Canary (gradual rollout), Rollback (automated revert)
**Tags:** infrastructure, ci-cd, continuous-deployment

### Pipeline
**Definition:** An automated sequence of stages (build, test, deploy) that code changes pass through on their way to production.
**Usage:** Use to automate the software delivery process. Each stage validates and transforms the artifact. A failed stage stops the pipeline and alerts the team.
**Related:** Stage (pipeline step), Artifact (pipeline output), Trigger (pipeline start), Gate (manual approval step)
**Tags:** infrastructure, ci-cd, pipeline

### Artifact
**Definition:** A deployable output of a build stage — compiled binary, Docker image, package, or archive — stored and versioned in an artifact repository.
**Usage:** Build once, deploy many. Artifacts should be immutable and versioned. Store in a registry (npm, Docker, Maven) for traceability. Distinguish from Source Code (the input) — Artifact is the built output.
**Related:** Build (artifact creation), Registry (artifact storage), Version (artifact identity), Checksum (artifact verification)
**Tags:** infrastructure, ci-cd, artifact

## Deployment

### Blue-Green Deployment
**Definition:** A deployment strategy maintaining two identical environments (blue = current, green = new) and switching traffic by updating the router.
**Usage:** Use for zero-downtime deployments with instant rollback. Green is fully deployed and tested before traffic switches. Rollback is flipping the router back to blue.
**Related:** Canary (gradual traffic shift), Rolling (incremental pod replacement), Zero-Downtime (the goal), A/B Testing (different purpose)
**Tags:** infrastructure, deployment, blue-green

### Canary Deployment
**Definition:** A deployment strategy where a new version is gradually exposed to a small subset of users before full rollout.
**Usage:** Use for risk reduction in production deployments. Monitor error rates and performance on the canary before increasing traffic. Distinguish from Blue-Green (instant switch) — Canary is gradual.
**Related:** Blue-Green (instant switch), Rolling (pod-by-pod), A/B Testing (feature comparison), Feature Flag (software-level toggle)
**Tags:** infrastructure, deployment, canary

### Rolling Deployment
**Definition:** A deployment strategy that updates instances incrementally, replacing old versions with new ones one at a time.
**Usage:** Default Kubernetes deployment strategy. No additional infrastructure needed. Rollback requires re-deploying the old version. Distinguish from Blue-Green (separate environments) — Rolling works within a single environment.
**Related:** Blue-Green (separate environment), Canary (subset-based), Rolling Update (Kubernetes), Rollback (revert)
**Tags:** infrastructure, deployment, rolling

### Feature Flag
**Definition:** A software toggle that enables or disables functionality at runtime without code deployment, controlling feature visibility per user or group.
**Usage:** Use for trunk-based development, gradual rollouts, A/B testing, or kill switches. Feature flags decouple deployment from release. Distinguish from Configuration (static) — Feature Flags are dynamic and targeted.
**Related:** A/B Testing (flag use case), Canary (flag use case), Kill Switch (emergency disable), Flag Debt (accumulated flags)
**Tags:** infrastructure, deployment, feature-flag

## Infrastructure as Code (IaC)

### Infrastructure as Code
**Definition:** Managing and provisioning infrastructure (servers, networks, databases) through machine-readable definition files, rather than manual processes.
**Usage:** Use for reproducible, version-controlled, automated infrastructure. Changes go through code review, just like application code. Distinguish from Configuration Management (installing software, managing configs).
**Related:** Terraform (IaC tool), Configuration Management (post-provisioning), Declarative (desired state), Drift (actual vs defined)
**Tags:** infrastructure, iac

### Terraform
**Definition:** An IaC tool that uses a declarative language (HCL) to define and provision infrastructure across multiple cloud providers.
**Usage:** Use for multi-cloud infrastructure, complex resource dependencies, or state-managed provisioning. Terraform maintains a state file tracking real-world resources vs defined resources.
**Related:** State (real-world tracking), Plan (preview changes), Apply (execute changes), Module (reusable config), Provider (cloud adapter)
**Tags:** infrastructure, iac, terraform

### State (IaC)
**Definition:** A file or backend storing the mapping between defined infrastructure resources and real-world resources, enabling drift detection and change planning.
**Usage:** Critical for Terraform and other stateful IaC tools. State must be stored securely and shared by the team (remote backend, not local files). State corruption or loss can cause resource mismanagement.
**Related:** Terraform (uses state), Drift (state vs reality), Remote State (shared backend), State Lock (prevent concurrent changes)
**Tags:** infrastructure, iac, state

### Drift (Infrastructure)
**Definition:** The divergence between declared infrastructure configuration (IaC) and the actual state of deployed resources.
**Usage:** Detect drift by running plan/validate commands. Drift occurs when changes are made outside IaC (manual console changes, auto-scaling events). Remediate by reconciling the IaC or adopting the drift.
**Related:** State (the reference), Reconciliation (fixing drift), Configuration Drift (broader concept), Immutable Infrastructure (drift-resistant)
**Tags:** infrastructure, iac, drift

## Cloud

### IaaS (Infrastructure as a Service)
**Definition:** Cloud computing model providing virtualized computing resources (VMs, storage, networking) on demand.
**Usage:** Use when you need full control over the operating system and middleware. You manage the OS and above; the provider manages the physical hardware. Distinguish from PaaS (managed platform) and SaaS (managed application).
**Related:** PaaS (platform managed), SaaS (application managed), VM (the resource), Cloud Provider (AWS, Azure, GCP)
**Tags:** infrastructure, cloud, iaas

### PaaS (Platform as a Service)
**Definition:** A cloud computing model providing a managed platform (runtime, database, middleware) where you deploy your application code without managing the underlying infrastructure.
**Usage:** Use to reduce operational overhead — deploy code, don't manage servers. Heroku, Cloud Run, Azure App Service are examples. Distinguish from IaaS (you manage VMs) and SaaS (you consume applications).
**Related:** IaaS (infrastructure management), SaaS (application consumption), Serverless (finer-grained PaaS)
**Tags:** infrastructure, cloud, paas

### SaaS (Software as a Service)
**Definition:** A cloud computing model where a complete application is provided over the internet, managed by the provider, consumed by end users.
**Usage:** Use for turnkey solutions — email, CRM, collaboration tools. Users don't manage or control the infrastructure. Distinguish from PaaS (you deploy your own app) — SaaS is ready-made software.
**Related:** PaaS (your app on managed platform), IaaS (your infrastructure), Multi-tenant (SaaS architecture)
**Tags:** infrastructure, cloud, saas

### Availability Zone
**Definition:** An isolated data center within a cloud region, with independent power, cooling, and networking, connected by low-latency links.
**Usage:** Deploy across multiple AZs for high availability. A failure in one AZ doesn't affect others. Distinguish from Region (geographic area containing multiple AZs) — AZs are within a region.
**Related:** Region (geographic area), Multi-AZ (redundancy strategy), Fault Tolerance (surviving AZ failure)
**Tags:** infrastructure, cloud, availability-zone

### CDN (Content Delivery Network)
**Definition:** A geographically distributed network of proxy servers that cache and deliver content from locations closer to end users.
**Usage:** Use for static assets (images, scripts, styles), video streaming, or any content that benefits from geographic proximity. Improves load times and reduces origin server load.
**Related:** Edge (CDN server location), Cache (CDN storage), Origin (source server), TTL (cache duration)
**Tags:** infrastructure, cloud, cdn

### Object Storage
**Definition:** A storage architecture that manages data as objects (file + metadata + ID), scalable to exabytes, with flat namespace and HTTP API access.
**Usage:** Use for unstructured data — images, videos, backups, logs, static website hosting. AWS S3 is the canonical example. Distinguish from Block Storage (VM-attached volumes) and File Storage (network file shares).
**Related:** S3 (AWS object storage), Blob (Azure object storage), Bucket (top-level container), Lifecycle Policy (automated transitions)
**Tags:** infrastructure, cloud, storage
