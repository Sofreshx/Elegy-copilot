---
name: cloudflare-storage
description: "Cloudflare storage services integration. Handles R2 object storage, Workers KV, and Images API. Use for 'Cloudflare R2', 'Workers KV', 'image CDN', or Cloudflare storage tasks."
tools: ['read', 'edit', 'search']
sources:
  - https://developers.cloudflare.com/r2/
  - https://developers.cloudflare.com/kv/
  - https://developers.cloudflare.com/images/
---

# Cloudflare Storage Skill

## Purpose
Cloudflare provides multiple storage solutions for different use cases: R2 for object/blob storage, Workers KV for key-value storage, and Images for image hosting and transformation.

## Service Overview

| Service | Use Case | API Style | Best For |
|---------|----------|-----------|----------|
| **R2** | Object/blob storage | S3-compatible | Files, media, backups |
| **Workers KV** | Key-value storage | REST / Workers Binding | Config, cache, sessions |
| **Images** | Image hosting | REST | Image optimization, CDN |

## Authentication

### Create API Token
1. Dashboard → My Profile → API Tokens
2. Create Token with required permissions
3. Use `Authorization: Bearer <token>` header

### API Token Header
```http
Authorization: Bearer <your-api-token>
```

---

## R2 Object Storage

### Overview
S3-compatible object storage without egress fees. Use for storing files, media, backups, and any blob data.

### S3 SDK Access (.NET)
```csharp
using Amazon.S3;
using Amazon.S3.Model;

// Configure S3 client for R2
var config = new AmazonS3Config
{
    ServiceURL = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
    ForcePathStyle = true
};

var credentials = new Amazon.Runtime.BasicAWSCredentials(
    accessKey: "<R2_ACCESS_KEY_ID>",
    secretKey: "<R2_SECRET_ACCESS_KEY>"
);

var s3Client = new AmazonS3Client(credentials, config);
```

### Upload Object
```csharp
public async Task UploadFileAsync(string bucket, string key, Stream content, string contentType)
{
    var request = new PutObjectRequest
    {
        BucketName = bucket,
        Key = key,
        InputStream = content,
        ContentType = contentType
    };
    
    await s3Client.PutObjectAsync(request);
}
```

### Download Object
```csharp
public async Task<Stream> DownloadFileAsync(string bucket, string key)
{
    var request = new GetObjectRequest
    {
        BucketName = bucket,
        Key = key
    };
    
    var response = await s3Client.GetObjectAsync(request);
    return response.ResponseStream;
}
```

### List Objects
```csharp
public async Task<List<S3Object>> ListObjectsAsync(string bucket, string? prefix = null)
{
    var request = new ListObjectsV2Request
    {
        BucketName = bucket,
        Prefix = prefix
    };
    
    var response = await s3Client.ListObjectsV2Async(request);
    return response.S3Objects;
}
```

### Delete Object
```csharp
public async Task DeleteFileAsync(string bucket, string key)
{
    await s3Client.DeleteObjectAsync(bucket, key);
}
```

### Generate Presigned URL
```csharp
public string GetPresignedUrl(string bucket, string key, TimeSpan expiry)
{
    var request = new GetPreSignedUrlRequest
    {
        BucketName = bucket,
        Key = key,
        Expires = DateTime.UtcNow.Add(expiry),
        Verb = HttpVerb.GET
    };
    
    return s3Client.GetPreSignedURL(request);
}
```

---

## Workers KV

### Overview
Global, low-latency key-value storage. Best for configuration, feature flags, user preferences, and caching.

### REST API Examples

#### Write Key-Value
```http
PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}
Authorization: Bearer <token>
Content-Type: text/plain

<value>
```

#### Read Key-Value
```http
GET https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}
Authorization: Bearer <token>
```

#### Delete Key-Value
```http
DELETE https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}
Authorization: Bearer <token>
```

#### List Keys
```http
GET https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys
Authorization: Bearer <token>
```

### .NET HttpClient Wrapper
```csharp
public class CloudflareKvClient
{
    private readonly HttpClient _http;
    private readonly string _accountId;
    private readonly string _namespaceId;

    public CloudflareKvClient(string apiToken, string accountId, string namespaceId)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri("https://api.cloudflare.com/client/v4/")
        };
        _http.DefaultRequestHeaders.Authorization = 
            new AuthenticationHeaderValue("Bearer", apiToken);
        _accountId = accountId;
        _namespaceId = namespaceId;
    }

    public async Task<string?> GetAsync(string key)
    {
        var response = await _http.GetAsync(
            $"accounts/{_accountId}/storage/kv/namespaces/{_namespaceId}/values/{key}");
        
        if (!response.IsSuccessStatusCode) return null;
        return await response.Content.ReadAsStringAsync();
    }

    public async Task PutAsync(string key, string value, int? expirationTtl = null)
    {
        var url = $"accounts/{_accountId}/storage/kv/namespaces/{_namespaceId}/values/{key}";
        if (expirationTtl.HasValue)
            url += $"?expiration_ttl={expirationTtl}";
        
        await _http.PutAsync(url, new StringContent(value));
    }

    public async Task DeleteAsync(string key)
    {
        await _http.DeleteAsync(
            $"accounts/{_accountId}/storage/kv/namespaces/{_namespaceId}/values/{key}");
    }
}
```

### Workers Binding (TypeScript)
```typescript
// wrangler.toml: [[kv_namespaces]] binding = "KV"

export default {
  async fetch(request: Request, env: { KV: KVNamespace }): Promise<Response> {
    // Write
    await env.KV.put('user:123', JSON.stringify({ name: 'John' }));
    
    // Read
    const value = await env.KV.get('user:123');
    
    // Read with metadata
    const { value: data, metadata } = await env.KV.getWithMetadata('user:123');
    
    // List keys
    const keys = await env.KV.list({ prefix: 'user:' });
    
    // Delete
    await env.KV.delete('user:123');
    
    return new Response(value);
  }
};
```

---

## Cloudflare Images

### Overview
Store, transform, and serve images with automatic optimization. Supports variants for different sizes/formats.

### Upload Image (REST API)
```http
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
```

### Upload via URL
```http
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/image.jpg"
}
```

### .NET Upload Example
```csharp
public class CloudflareImagesClient
{
    private readonly HttpClient _http;
    private readonly string _accountId;

    public CloudflareImagesClient(string apiToken, string accountId)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri("https://api.cloudflare.com/client/v4/")
        };
        _http.DefaultRequestHeaders.Authorization = 
            new AuthenticationHeaderValue("Bearer", apiToken);
        _accountId = accountId;
    }

    public async Task<string> UploadImageAsync(Stream imageStream, string fileName)
    {
        using var content = new MultipartFormDataContent();
        content.Add(new StreamContent(imageStream), "file", fileName);
        
        var response = await _http.PostAsync(
            $"accounts/{_accountId}/images/v1", content);
        
        var result = await response.Content.ReadFromJsonAsync<CloudflareResponse<ImageResult>>();
        return result!.Result!.Id;
    }

    public async Task DeleteImageAsync(string imageId)
    {
        await _http.DeleteAsync($"accounts/{_accountId}/images/v1/{imageId}");
    }
}

public record CloudflareResponse<T>(bool Success, T? Result);
public record ImageResult(string Id, string[] Variants);
```

### Serve Image with Variants
```
https://imagedelivery.net/<account_hash>/<image_id>/<variant_name>
```

Example variants:
- `public` - Original size
- `thumbnail` - 150x150
- `medium` - 800px width

### Create Variant (Dashboard or API)
```http
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1/variants
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "thumbnail",
  "options": {
    "fit": "cover",
    "width": 150,
    "height": 150
  }
}
```

### Direct Creator Upload (Secure Upload URL)
```csharp
public async Task<string> GetDirectUploadUrlAsync()
{
    var response = await _http.PostAsync(
        $"accounts/{_accountId}/images/v2/direct_upload",
        new StringContent("{}", Encoding.UTF8, "application/json"));
    
    var result = await response.Content.ReadFromJsonAsync<CloudflareResponse<DirectUpload>>();
    return result!.Result!.UploadUrl;
}

public record DirectUpload(string Id, string UploadUrl);
```

---

## Best Practices

### R2
1. **Use Presigned URLs**: For secure, time-limited access
2. **Multipart Upload**: For files > 100MB
3. **Lifecycle Rules**: Auto-delete old objects
4. **Public Buckets**: Use R2 public buckets for static assets

### Workers KV
1. **TTL for Cache**: Set `expiration_ttl` for cached data
2. **Prefix Keys**: Use `user:123:profile` pattern for organization
3. **JSON Values**: Store complex data as JSON strings
4. **Eventual Consistency**: KV is eventually consistent globally

### Images
1. **Variants**: Pre-define common sizes to reduce transformations
2. **Direct Upload**: Let users upload directly to Cloudflare
3. **Signed URLs**: Protect private images with signed delivery URLs

## Common Gotchas

- **R2 Egress**: Free egress is a major R2 advantage over S3
- **KV Limits**: 25MB max value size, 512 bytes max key size
- **KV Consistency**: Writes propagate globally in ~60 seconds
- **Images Pricing**: Per-image storage + per-transformation billing
- **API Rate Limits**: Check account limits for API calls

````
