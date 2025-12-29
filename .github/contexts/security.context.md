# Security Context & Secrets Management

## Secrets Management Standard

### 1. Local Development
*   **Do NOT** commit secrets to Git.
*   **Do NOT** put secrets in `appsettings.json` or `config.ts`.

#### .NET Projects
*   **Tool**: Use [Secret Manager](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (User Secrets).
*   **Setup**:
    ```bash
    dotnet user-secrets init
    dotnet user-secrets set "MySecret" "Value"
    ```
*   **Access**: `IConfiguration["MySecret"]`
*   **Check**: Ensure `.csproj` contains `<UserSecretsId>`.

#### Node/JS Projects
*   **Tool**: `.env` files.
*   **Enforcement**: Ensure `.env` is listed in `.gitignore`.
*   **Template**: Commit a `.env.example` with empty values.

### 2. CI/CD (GitHub Actions)
*   **Storage**: Store all secrets in GitHub Repository Settings > Secrets and variables > Actions.
*   **Usage**: Inject as environment variables in `.github/workflows/*.yml`.
    ```yaml
    env:
      ApiKey: ${{ secrets.API_KEY }}
    ```

### 3. Prevention & Detection
*   **Pre-commit**: Check for high-entropy strings or known key formats (AWS, Stripe, etc.).
*   **Code Review**: Flag any string that looks like a credential.
*   **Logs**: Ensure secrets are redacted in logs.

## Common Vulnerabilities to Watch
*   **Hardcoded Secrets**: API keys, connection strings, passwords in source code.
*   **Committed Configs**: `appsettings.Development.json` or `.env` files accidentally committed.
*   **Logging Secrets**: Printing full request objects or config objects to console/logs.
