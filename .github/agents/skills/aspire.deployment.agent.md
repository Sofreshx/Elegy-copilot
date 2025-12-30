---
name: aspire-deployment
description: ".NET Aspire deployment and publishing. Handles aspire publish, deploy, and manifest generation. Use for 'deploy Aspire app', 'publish to Azure', 'generate manifest', or Aspire deployment tasks."
tools: ['read', 'edit', 'search', 'execute']
sources:
  - https://aspire.dev/deployment/overview/
  - https://aspire.dev/deployment/manifest-format/
---

# .NET Aspire Deployment Skill

## Purpose
Aspire separates publishing (generating deployment artifacts) from deployment (applying changes). The Aspire CLI provides `aspire publish` and `aspire deploy` commands that work with hosting integrations.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Publish** | Generate deployment artifacts with parameter placeholders |
| **Deploy** | Resolve parameters and apply changes to target environment |
| **Hosting Integration** | NuGet package providing publish/deploy capabilities |
| **Compute Environment** | Target platform (Docker Compose, K8s, Azure) |

## CLI Commands

### Generate Artifacts
```bash
# Publish to output directory
aspire publish -o artifacts/

# Results in: docker-compose.yml, manifests, specs, etc.
```

### Deploy (if integration supports it)
```bash
# Resolve parameters and apply deployment
aspire deploy
```

## Hosting Integrations

| Package | Target | Publish | Deploy |
|---------|--------|---------|--------|
| `Aspire.Hosting.Docker` | Docker Compose | ✅ | ❌ |
| `Aspire.Hosting.Kubernetes` | Kubernetes | ✅ | ❌ |
| `Aspire.Hosting.Azure.AppContainers` | Azure Container Apps | ✅ | ✅ (Preview) |
| `Aspire.Hosting.Azure.AppService` | Azure App Service | ✅ | ✅ (Preview) |

## Docker Compose Deployment

### Add Integration
```csharp
// In AppHost Program.cs
var builder = DistributedApplication.CreateBuilder(args);

// Add Docker Compose as compute environment
var compose = builder.AddDockerComposeEnvironment("compose");

var postgres = builder.AddPostgres("db").WithDataVolume();
var api = builder.AddProject<Projects.Api>("api")
    .WithReference(postgres);

builder.Build().Run();
```

### Publish
```bash
aspire publish -o artifacts/
```

### Generated docker-compose.yml
```yaml
services:
  db:
    image: "docker.io/library/postgres:17.2"
    environment:
      POSTGRES_PASSWORD: "${DB_PASSWORD}"  # Placeholder
    ports:
      - "8000:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
  api:
    image: "${API_IMAGE}"  # Placeholder
    environment:
      ConnectionStrings__db: "Host=db;Port=5432;Password=${DB_PASSWORD};Database=app"
    depends_on:
      db:
        condition: service_started
```

### Run with Docker Compose
```bash
# Set required environment variables
export DB_PASSWORD=mysecretpassword
export API_IMAGE=myregistry/api:latest

# Run
docker compose -f artifacts/docker-compose.yml up --build
```

## Kubernetes Deployment

### Add Integration
```csharp
var builder = DistributedApplication.CreateBuilder(args);

var k8s = builder.AddKubernetesEnvironment("k8s");

// Resources automatically get K8s manifests
builder.AddPostgres("db");
builder.AddProject<Projects.Api>("api");

builder.Build().Run();
```

### Publish
```bash
aspire publish -o manifests/
# Generates: deployment.yaml, service.yaml, configmap.yaml, etc.
```

### Apply with kubectl
```bash
kubectl apply -f manifests/
```

## Azure Container Apps

### Add Integration
```csharp
var builder = DistributedApplication.CreateBuilder(args);

// Add Azure Container Apps environment
builder.AddAzureContainerAppsInfrastructure();

var api = builder.AddProject<Projects.Api>("api");

builder.Build().Run();
```

### Deploy Directly
```bash
# Azure integration supports deploy command
aspire deploy
```

## Parameter Placeholders

Published artifacts contain placeholders, not actual values:

```yaml
# Placeholders in artifacts
POSTGRES_PASSWORD: "${PG_PASSWORD}"
ConnectionStrings__db: "Host=pg;Password=${PG_PASSWORD}"
API_IMAGE: "${DBSETUP_IMAGE}"
```

### Resolution Methods
- **Environment Variables**: `export PG_PASSWORD=secret`
- **`.env` File**: Docker Compose reads `.env` automatically
- **CI/CD Injection**: GitHub Actions, Azure DevOps secrets
- **`aspire deploy`**: Resolves interactively for supported integrations

## Multiple Compute Environments

### Disambiguate Resources
```csharp
var k8s = builder.AddKubernetesEnvironment("k8s-env");
var compose = builder.AddDockerComposeEnvironment("docker-env");

// Explicitly assign resources to environments
builder.AddProject<Projects.Frontend>("frontend")
    .WithComputeEnvironment(k8s);

builder.AddProject<Projects.Backend>("backend")
    .WithComputeEnvironment(compose);
```

## Custom Publishing Callbacks

### Custom Publish Logic
```csharp
var resource = builder.AddProject<Projects.Api>("api");

resource.Resource.Annotations.Add(new PublishingCallbackAnnotation(async ctx =>
{
    var reporter = ctx.ActivityReporter;
    await using var step = await reporter.CreateStepAsync("Custom publish step", ctx.CancellationToken);
    
    // Custom publishing logic here
    
    await step.SucceedAsync("Publish completed", ctx.CancellationToken);
}));
```

### Custom Deploy Logic
```csharp
resource.Resource.Annotations.Add(new DeployingCallbackAnnotation(async ctx =>
{
    var interactionService = ctx.Services.GetRequiredService<IInteractionService>();
    
    // Prompt user for input
    var envResult = await interactionService.PromptInputAsync(
        "Environment Configuration",
        "Enter target environment:",
        new InteractionInput
        {
            Label = "Environment Name",
            InputType = InputType.Text,
            Required = true,
            Placeholder = "dev, staging, prod"
        },
        cancellationToken: ctx.CancellationToken);
    
    // Custom deployment logic
    var reporter = ctx.ActivityReporter;
    await using var step = await reporter.CreateStepAsync(
        $"Deploying to {envResult.Value}", ctx.CancellationToken);
    
    await Task.Delay(2000, ctx.CancellationToken);  // Simulate work
    await step.SucceedAsync("Deployment complete", ctx.CancellationToken);
}));
```

## Azure Developer CLI (azd)

### Initialize
```bash
azd init
```

### Deploy
```bash
azd up
```

### azd has first-class Aspire support:
- Provisions Azure infrastructure
- Manages environments
- Handles secret injection
- Coordinates deployments

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'
      
      - name: Install Aspire CLI
        run: dotnet tool install -g aspire.cli
      
      - name: Publish artifacts
        run: aspire publish -o artifacts/
        working-directory: ./src/AppHost
      
      - name: Deploy to Azure
        env:
          AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}
        run: |
          az login --service-principal -u $AZURE_CLIENT_ID -p $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID
          aspire deploy
```

## Typical Workflow

1. **Development**: Run AppHost locally with `dotnet run`
2. **Publish**: Generate artifacts with `aspire publish -o artifacts/`
3. **Review**: Check generated Compose/K8s files
4. **Test**: Run locally with `docker compose up`
5. **Deploy**: Use `aspire deploy` or apply with platform tools

## Diagnostics & Auditing

```bash
# Generate legacy manifest for debugging
aspire publish --publisher manifest -o diagnostics/
```

Useful for:
- Diffing outputs between commits
- Scanning for disallowed images
- Compliance records

## Best Practices

1. **Separate Structure from Values**: Publish preserves shape, deploy injects values
2. **Review Artifacts**: Always check generated files before deployment
3. **Use Secrets Management**: Never commit resolved secrets
4. **Version Artifacts**: Track generated manifests in version control
5. **Test Locally First**: Run docker-compose locally before cloud deployment

## Common Gotchas

- **No Deploy Support**: Docker/K8s integrations don't support `aspire deploy` - use platform tools
- **Missing Integrations**: Check you have the right hosting integration package
- **Placeholder Resolution**: Ensure all `${VAR}` placeholders are provided at runtime
- **Image Tags**: Published images use placeholders - set actual tags in CI/CD

````
