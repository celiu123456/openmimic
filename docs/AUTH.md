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
a random 256-bit value generated once on first server start and persisted
in the `api_settings` table under the key `token_salt`.

```
salt = random(32 bytes)          -- stored in DB, generated once
hash = SHA-256(salt + plaintext)
```

The salt is independent of the admin token. Rotating
`OPENMIMIC_ADMIN_TOKEN` does **not** invalidate existing scoped tokens.

> **Migration from versions before 2026-10-06**: the salt was previously
> derived from the admin token via HMAC-SHA256. After upgrading, existing
> tokens will fail to resolve (401 `unauthorized`). Affected users must
> recreate their scoped tokens once.

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

## Route-scope table

Every route declares its required scope. Routes without a declaration
default to `admin` (fail-closed). The table below is the authoritative
reference; a test (`scoped-auth.test.ts`) enforces zero undeclared routes.

| Method | Path | Scope |
|--------|------|-------|
| GET | `/api/health` | open |
| GET | `/api/capabilities` | open |
| GET | `/api/invites/:token` | open |
| POST | `/api/invites/:token/interview` | open |
| POST | `/api/invites/:token/interview/:id/answer` | open |
| POST | `/api/invites/:token/interview/:id/submit` | open |
| GET | `/api/i/:code` | open |
| GET | `/api/asr/available` | open |
| POST | `/api/asr` | open |
| POST | `/api/collector/freetext` | open |
| GET | `/api/subjects` | persona.read |
| POST | `/api/subjects` | admin |
| GET | `/api/subjects/:id` | persona.read |
| GET | `/api/subjects/:id/claims` | testimony.read |
| GET | `/api/subjects/:id/coverage` | admin |
| POST | `/api/subjects/:id/invites` | admin |
| GET | `/api/subjects/:id/export` | export |
| GET | `/api/subjects/:id/rooms` | room.read |
| POST | `/api/subjects/:id/room` | room.run |
| GET | `/api/rooms/:id` | room.read |
| POST | `/api/subjects/:id/court` | court.run |
| GET | `/api/court/:sessionId` | testimony.read |
| POST | `/api/import` | admin |
| GET | `/api/tokens` | admin |
| POST | `/api/tokens` | admin |
| DELETE | `/api/tokens/:id` | admin |
| GET | `/v1/models` | persona.read |
| POST | `/v1/chat/completions` | persona.chat |
| GET | `/api/subjects/:id/gate/contested` | testimony.read |
| POST | `/api/subjects/:id/gate/contest` | admin |
| POST | `/api/subjects/:id/gate/uncontest` | admin |
| GET | `/api/subjects/:id/meta-perception/*` | admin |
| GET | `/api/subjects/:id/chatlog/imports` | admin |
| POST | `/api/subjects/:id/chatlog/*` | admin |
| DELETE | `/api/subjects/:id/chatlog/imports/:id` | admin |
| POST | `/api/subjects/:id/biography/generate` | admin |
| GET | `/api/subjects/:id/biography` | export |
| POST | `/api/subjects/:id/biography/sections/*/veto` | admin |
| GET | `/api/subjects/:id/export/character-card` | export |
| POST | `/api/import/character-card` | admin |

## Output-side persona verification

When a persona replies via `/v1/chat/completions`, the server optionally
verifies the response against the evidence assembled into the system prompt.

- **Toggle**: `PERSONA_VERIFY` environment variable (default: **enabled**).
  Set to `0`, `off`, or `false` to disable.
- **Requirement**: an LLM client must be available in the DI container
  (the same one used by room/court). Without it, verification is silently
  disabled.
- **Non-stream**: after the upstream model responds, the verifier checks
  for unfounded content. If found, it rewrites the response (up to one
  rewrite + re-verify cycle). On failure, a conservative fallback response
  is returned. The `x-openmimic-verify` header reports the outcome:
  `passed`, `rewritten`, or `failed`.
- **Stream**: when verification is enabled, streaming requests are buffered
  server-side (the full response is collected before verification). After
  verification, the final response is re-emitted as valid SSE chunks. The
  `x-openmimic-verify` header is set to `buffered`, `buffered-passed`,
  `buffered-rewritten`, or `failed`. **This adds first-token latency**
  equal to the full generation time plus one or more verification LLM
  calls (~1-5s depending on response length). When verification is
  disabled, streaming passes through directly with no additional latency.
- **No request-level override**: scoped tokens (`persona.chat`) cannot
  disable verification via request parameters. The toggle is instance-level
  only.
- **Usage accounting**: verification LLM calls are tagged `persona-verify`
  in the usage ledger and count against the instance's budget.
- **Error handling**: if the verification LLM call fails (timeout, budget
  exhaustion, etc.), the unverified response is **never** returned. Instead,
  a conservative in-character fallback is sent with `x-openmimic-verify:
  failed`. Upstream errors (402, 429, etc.) are not swallowed -- they
  propagate as 502 before verification is attempted.

## Known limitations

- **Single instance**: this is a simple, single-instance token system. There
  is no OAuth, no multi-tenant isolation, no token rotation API.
- **In-memory rate limiting**: rate limits reset on server restart. There is
  no distributed rate limiting.
- **No token rotation**: to rotate a token, delete the old one and create a
  new one. The client must update its configuration.
- **One-way salt migration**: upgrading from the old admin-derived salt
  invalidates existing tokens (see "Token hashing" above). New tokens
  are unaffected by admin password rotation.
- **Loopback mode**: when no admin token is set, the server binds to
  127.0.0.1 only. Scoped tokens still work but there is no network
  protection -- the documentation warns about this risk.
