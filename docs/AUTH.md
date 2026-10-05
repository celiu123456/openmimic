# Authentication & Authorization

OpenMimic supports two authentication mechanisms:

1. **Admin token** (`OPENMIMIC_ADMIN_TOKEN`): a single instance-level password
   that grants full access. This is the original mechanism and its behavior is
   unchanged.

2. **Scoped API tokens** (`omk_...`): created via the REST API, each token
   carries an explicit set of scopes and optional subject bindings.

## Scopes

Every scope is an explicit, known string. Wildcards (`*`) are forbidden.
Unknown scopes are rejected at token creation time.

| Scope | Description |
|-------|-------------|
| `persona.chat` | Converse with a persona via the OpenAI-compatible endpoint. |
| `persona.read` | List personas and read assembly metadata (no testimony text, no system prompt). |
| `testimony.read` | Read raw testimony text. Not granted by default to any token. |
| `testimony.write` | Submit testimony on behalf of a witness (collector integrations). |
| `court.run` | Trigger a court session for a subject. |
| `room.run` | Create and enter rooms for a subject. |
| `room.read` | List and read existing room transcripts for a subject. |
| `export` | Export a persona package (.persona). |
| `admin` | Full administrative access (equivalent to the instance admin token). |

## Token management

### Create a token

```
POST /api/tokens
Authorization: Bearer <admin-token>

{
  "name": "my-integration",
  "scopes": ["persona.chat"],
  "subjectIds": ["subject-uuid"],   // optional: restrict to specific subjects
  "expiresAt": "2026-12-31T23:59:59Z"  // optional
}
```

Response (201):
```json
{
  "id": "token-uuid",
  "name": "my-integration",
  "prefix": "omk_abcdef12",
  "scopes": ["persona.chat"],
  "subjectIds": ["subject-uuid"],
  "createdAt": "2026-10-06T...",
  "expiresAt": "2026-12-31T23:59:59Z",
  "token": "omk_abcdef1234567890..."
}
```

The `token` field contains the plaintext API token. **It is shown exactly once
and never stored or returned again.** The database stores only a salted
SHA-256 hash.

### List tokens

```
GET /api/tokens
Authorization: Bearer <admin-token>
```

Returns all tokens with metadata (name, prefix, scopes, usage stats) but
never the plaintext or hash.

### Revoke a token

```
DELETE /api/tokens/:id
Authorization: Bearer <admin-token>
```

Revocation is immediate. Any in-flight request using the token will fail.

## Token format

Tokens use the prefix `omk_` followed by 64 hex characters (256 bits of
entropy):

```
omk_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

The `omk_` prefix makes tokens identifiable by secret-scanning tools
(GitHub, GitLab, etc.).

## Token hashing

Tokens are hashed with SHA-256 using an instance-level salt. The salt is
derived from `OPENMIMIC_ADMIN_TOKEN` via HMAC-SHA256:

```
salt = HMAC-SHA256(adminToken, "openmimic:token-salt:v1")
hash = SHA-256(salt + plaintext)
```

When no admin token is configured, a random salt is generated at process
start (tokens are session-scoped in that case).

## Subject binding

A token may optionally be bound to one or more subject IDs. When bound:

- The token can only access data for the specified subjects.
- `/v1/models` only lists the bound subjects' personas.
- Requests targeting other subjects receive 403 `forbidden_subject`.

When not bound (empty `subjectIds`), the token can access any subject
its scopes allow.

## Using a token

Tokens are sent the same way as the admin token:

1. `Authorization: Bearer omk_...` header (preferred)
2. `_token=omk_...` cookie
3. `?_token=omk_...` query parameter

## Route scope enforcement

Every route declares the scope it requires. The enforcement order is:

1. **Open routes** (health, invites, interviews, capabilities): no auth needed.
2. **Route scope check**: the token must carry the declared scope.
3. **Subject binding check**: for routes with a subject parameter.
4. **Fail-closed default**: routes without a scope declaration require `admin`.

The admin token bypasses all scope checks (it is equivalent to a token with
the `admin` scope).

## Embedding scenario: recommended configuration

When embedding OpenMimic as a persona backend for a third-party application:

1. Create a token with only `persona.chat` (and optionally `persona.read`):
   ```
   POST /api/tokens
   { "name": "my-app", "scopes": ["persona.chat", "persona.read"] }
   ```

2. Bind the token to the specific subjects the application should access:
   ```
   POST /api/tokens
   {
     "name": "my-app",
     "scopes": ["persona.chat", "persona.read"],
     "subjectIds": ["subject-1", "subject-2"]
   }
   ```

3. The application uses `Bearer omk_...` for all requests.

With this configuration, the third-party application:
- Can chat with personas via `/v1/chat/completions`
- Can list available personas via `/v1/models`
- Cannot read raw testimony text
- Cannot run court sessions
- Cannot export persona packages
- Cannot manage tokens or subjects
- Cannot see the persona's full system prompt
- Cannot disable output-side fact checking or privacy filtering

## Relation to the admin token

| Feature | Admin token | Scoped token |
|---------|------------|--------------|
| Create subjects | Yes | No (unless `admin` scope) |
| Chat with personas | Yes | Yes (with `persona.chat`) |
| Read testimony | Yes | Only with `testimony.read` |
| Run court | Yes | Only with `court.run` |
| Export | Yes | Only with `export` |
| Manage tokens | Yes | No (unless `admin` scope) |
| Subject binding | No (access all) | Optional |
| Rate limiting | No | Yes (per-token) |
| Revocable | No | Yes |
| Expiry | No | Optional |

## Per-token rate limiting

Scoped tokens are rate-limited (default: 60 requests/minute per token).
The admin token is not rate-limited. Rate limiting is in-memory and resets
on server restart.

## Capability directory

```
GET /api/capabilities
```

Returns the full capability directory (publicly readable, no auth required).
Contains the list of capabilities with their required scopes, routes, and
error codes. Does not contain any data.

## Stable error codes

Auth and permission errors use stable codes that never change:

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `unauthorized` | 401 | No token, invalid token, or wrong admin token |
| `forbidden_scope` | 403 | Token does not have the required scope |
| `forbidden_subject` | 403 | Token is not authorized for this subject |
| `token_revoked` | 401 | Token has been revoked |
| `token_expired` | 401 | Token has expired |
| `rate_limited` | 429 | Rate limit exceeded |

Response format:
```json
{
  "error": {
    "code": "forbidden_scope",
    "message": "Token does not have the required scope: testimony.read"
  }
}
```

## Known limitations

- **Single instance**: this is a simple, single-instance token system. There
  is no OAuth, no multi-tenant isolation, no token rotation API.
- **In-memory rate limiting**: rate limits reset on server restart. There is
  no distributed rate limiting.
- **No token rotation**: to rotate a token, delete the old one and create a
  new one. The client must update its configuration.
- **Salt tied to admin token**: changing the admin token invalidates all
  existing scoped tokens (their hashes won't match the new salt). This is
  intentional: if the admin token is compromised, all derived tokens should
  be invalidated.
- **Loopback mode**: when no admin token is set, the server binds to
  127.0.0.1 only. Scoped tokens still work but there is no network
  protection -- the documentation warns about this risk.
