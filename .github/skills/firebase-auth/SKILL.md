---
name: firebase-auth
description: "Firebase Authentication with Admin SDK for .NET. Handles user management, token verification, custom claims, and role-based access. Use for Firebase auth, JWT verification, or custom claims."
tools: ['read', 'edit', 'search']
sources:
  - https://firebase.google.com/docs/auth/admin/verify-id-tokens
  - https://firebase.google.com/docs/auth/admin/custom-claims
  - https://firebase.google.com/docs/auth/admin/manage-users
---

# Firebase Auth Skill

## Purpose
Integrate Firebase Authentication for user identity and role management using Custom Claims.

## Setup

### Frontend (React)
1.  **Package**: `npm install firebase`
2.  **Initialization**:
    ```typescript
    // src/config/firebase.ts
    import { initializeApp } from "firebase/app";
    import { getAuth } from "firebase/auth";

    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      // ... other config
    };

    const app = initializeApp(firebaseConfig);
    export const auth = getAuth(app);
    ```

### Backend (.NET)
1.  **Package**: `dotnet add package FirebaseAdmin`
2.  **Initialization** (DI Container):
    ```csharp
    // Program.cs
    using FirebaseAdmin;
    using Google.Apis.Auth.OAuth2;

    // Use Application Default Credentials (ADC) for production/container environments
    // Use User Secrets for local development
    builder.Services.AddSingleton(FirebaseApp.Create(new AppOptions()
    {
        Credential = GoogleCredential.GetApplicationDefault()
    }));
    builder.Services.AddSingleton(FirebaseAuth.DefaultInstance);
    ```

## User Management (Admin SDK)

### Get User by UID
```csharp
public async Task<UserRecord> GetUserAsync(string uid)
{
    return await FirebaseAuth.DefaultInstance.GetUserAsync(uid);
}
```

### Get User by Email
```csharp
public async Task<UserRecord> GetUserByEmailAsync(string email)
{
    return await FirebaseAuth.DefaultInstance.GetUserByEmailAsync(email);
}
```

### Create User
```csharp
public async Task<UserRecord> CreateUserAsync(string email, string password)
{
    var args = new UserRecordArgs
    {
        Email = email,
        EmailVerified = false,
        Password = password,
        DisplayName = "New User",
        Disabled = false
    };
    
    return await FirebaseAuth.DefaultInstance.CreateUserAsync(args);
}
```

### Update User
```csharp
public async Task<UserRecord> UpdateUserAsync(string uid, string newEmail)
{
    var args = new UserRecordArgs
    {
        Uid = uid,
        Email = newEmail,
        EmailVerified = true
    };
    
    return await FirebaseAuth.DefaultInstance.UpdateUserAsync(args);
}
```

### Delete User
```csharp
public async Task DeleteUserAsync(string uid)
{
    await FirebaseAuth.DefaultInstance.DeleteUserAsync(uid);
}
```

### List All Users (Paginated)
```csharp
public async Task ListAllUsersAsync()
{
    var pagedEnumerable = FirebaseAuth.DefaultInstance.ListUsersAsync(null);
    var enumerator = pagedEnumerable.GetAsyncEnumerator();
    
    while (await enumerator.MoveNextAsync())
    {
        ExportedUserRecord user = enumerator.Current;
        Console.WriteLine($"User: {user.Uid} - {user.Email}");
    }
}
```

## Token Verification (Admin SDK)

### Verify ID Token
```csharp
public async Task<FirebaseToken> VerifyTokenAsync(string idToken)
{
    // Verifies signature, expiry, audience, and issuer
    var decodedToken = await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(idToken);
    
    string uid = decodedToken.Uid;
    // Access custom claims
    bool isAdmin = decodedToken.Claims.TryGetValue("admin", out var adminClaim) 
        && (bool)adminClaim;
    
    return decodedToken;
}
```

### Check Token Revocation
```csharp
public async Task<FirebaseToken> VerifyTokenWithRevocationCheckAsync(string idToken)
{
    // Also checks if token was revoked
    return await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(idToken, checkRevoked: true);
}
```

## Custom Claims Management

Custom claims are used for Role-Based Access Control (RBAC) (e.g., `admin`, `premium`).

### 1. Setting Claims (Backend)
Use the Admin SDK to set claims. This usually happens in a background job or an HTTP endpoint protected by a master key or initial setup logic.

```csharp
public class AuthService(FirebaseAuth firebaseAuth)
{
    public async Task SetAdminRoleAsync(string uid)
    {
        var claims = new Dictionary<string, object>
        {
            { "admin", true },
            { "accessLevel", 10 }
        };

        await firebaseAuth.SetCustomUserClaimsAsync(uid, claims);
    }
    
    // IMPORTANT: To add claims without overwriting, merge first
    public async Task AddClaimAsync(string uid, string key, object value)
    {
        var user = await firebaseAuth.GetUserAsync(uid);
        var currentClaims = user.CustomClaims ?? new Dictionary<string, object>();
        var newClaims = new Dictionary<string, object>(currentClaims)
        {
            [key] = value
        };
        await firebaseAuth.SetCustomUserClaimsAsync(uid, newClaims);
    }
}
```

### 2. Propagating to Client (Frontend)
After claims are modified on the server, the client must force a token refresh to see them immediately.

```typescript
import { auth } from "./config/firebase";

const refreshUserClaims = async () => {
  const user = auth.currentUser;
  if (user) {
    // true = force refresh to fetch new claims
    const tokenResult = await user.getIdTokenResult(true);
    console.log("New Claims:", tokenResult.claims);
    return tokenResult.claims;
  }
};
```

### 3. Verifying & Reading Claims (Backend - The Solid Way)
Instead of manually verifying tokens in every endpoint, implement an **Authentication Handler** to integrate with ASP.NET Core's standard `[Authorize]`.

**A. Configure Authentication (Program.cs)**
```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = $"https://securetoken.google.com/{builder.Configuration["Firebase:ProjectId"]}";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"https://securetoken.google.com/{builder.Configuration["Firebase:ProjectId"]}",
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Firebase:ProjectId"],
            ValidateLifetime = true
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireClaim("admin", "true"));
});
```

**B. Use Standard Attributes**
```csharp
[Authorize(Policy = "AdminOnly")]
[HttpPost("/admin/dashboard")]
public IResult AdminDashboard()
{
    return Results.Ok("Welcome Admin");
}
```

### 4. The "Syncing" Pattern (Crucial)
Custom claims set on the server are **NOT** automatically pushed to the client. The client must explicitly refresh the token.

**The Flow:**
1.  **Client**: User performs action (e.g., "Buy Premium").
2.  **Server**: Validates payment, calls `SetCustomUserClaimsAsync(uid, { premium: true })`.
3.  **Server**: Returns `200 OK`.
4.  **Client**: Receives `200 OK`. **IMMEDIATELY** calls `user.getIdTokenResult(true)`.
5.  **Client**: The new token now contains `premium: true`.

**React Hook Example:**
```typescript
const useForceRefresh = () => {
  const { currentUser } = getAuth();
  
  return async () => {
    if (!currentUser) return;
    // Force refresh to get latest claims from server
    await currentUser.getIdTokenResult(true);
  };
};
```

### 5. React Route Guard (HOC)
Protect routes based on claims.

```typescript
export const AdminRoute = ({ children }: { children: JSX.Element }) => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  
  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsAdmin(false);
        return;
      }
      const token = await user.getIdTokenResult();
      setIsAdmin(!!token.claims.admin);
    };
    check();
  }, []);

  if (isAdmin === null) return <div>Loading...</div>;
  return isAdmin ? children : <Navigate to="/login" />;
};
```

## Security Best Practices

- **Validation**: Always verify the token on the backend using `VerifyIdTokenAsync`. Never trust the client-side token payload without verification.
- **Size Limit**: Custom claims payload must not exceed 1000 bytes.
- **Sensitive Data**: Do not store PII in custom claims; use the database for that.
- **Service Accounts**: Use User Secrets for local dev and Managed Identity/Environment Variables for production credentials.
- **Claims Are Not Real-Time**: Claims are embedded in the token at issue time. Force refresh after changes.
- **OIDC Reserved Names**: Don't use reserved claim names like `iss`, `sub`, `aud`, `exp`, `iat`, `auth_time`.

## Common Gotchas

- **SetCustomUserClaims Overwrites**: Calling `SetCustomUserClaimsAsync` replaces ALL existing claims, not merges. Always fetch current claims first if adding incrementally.
- **Token Not Auto-Refreshed**: Client must call `getIdTokenResult(true)` to see new claims
- **Default Token Lifetime**: ID tokens expire after 1 hour by default
- **Project ID Required**: Token verification needs project ID (from service account or `GOOGLE_CLOUD_PROJECT` env var)
- **Email Lookup Limitation**: `GetUserByEmailAsync` only searches top-level email, not provider-specific emails


