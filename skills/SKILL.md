---
name: lazy-llm-proxy
description: Manage lazy-llm-proxy via its Admin HTTP API — create/revoke API keys, add/remove upstream providers, set token quotas, query usage stats, and configure IP allowlists and system prompts. Use when the user wants to manage LLM proxy configuration through API calls.
metadata:
  author: lazy-llm-proxy
  version: "2.0.0"
  promptSignals:
    phrases:
      - "proxy"
      - "apikey"
      - "api key"
      - "provider"
      - "quota"
      - "token limit"
      - "upstream"
      - "downstream"
      - "admin api"
---

# lazy-llm-proxy Admin API

OpenAI API proxy built with Bun + Elysia. Management is exposed via `/admin/*` HTTP endpoints, authenticated with an Admin Token generated at startup (printed to the console).

## Auth

All `/admin/*` endpoints use Bearer token auth. The token is printed to the console when the service starts.

```
Authorization: Bearer <ADMIN_TOKEN>
```

## Base URL

Default is `http://localhost:5001`. Examples below omit the base URL.

## Provider API

### Create a provider

```bash
curl -X POST /admin/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"openai","base_url":"https://api.openai.com/v1","api_key":"sk-xxx","models":["gpt-4o","gpt-4o-mini"]}'
# → {"id":"<uuid>"}
```

### List all providers

```bash
curl /admin/providers -H "Authorization: Bearer $TOKEN"
```

### Get a single provider

```bash
curl /admin/providers/:id -H "Authorization: Bearer $TOKEN"
```

### Update a provider (partial)

```bash
curl -X PATCH /admin/providers/:id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"sk-new","models":["gpt-4o","o1"]}'
```

### Delete a provider

```bash
curl -X DELETE /admin/providers/:id -H "Authorization: Bearer $TOKEN"
```

### Provider usage

```bash
curl /admin/providers/:id/usage -H "Authorization: Bearer $TOKEN"
# → [{"model":"gpt-4o","prompt_tokens":1200,"completion_tokens":800,"total_tokens":2000,"requests":15}]
```

## ApiKey API

### Issue an ApiKey

```bash
curl -X POST /admin/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "providers": ["<provider-id>"],
    "token_limit": 100000,
    "system_prompt": "You are a helpful assistant",
    "force_prompt": true,
    "expires_at": "2026-12-31T23:59:59Z",
    "ips": ["10.0.0.1"],
    "model_names": ["gpt-4o"]
  }'
# → {"key":"sk-..."}
```

Fields:

| Field | Required | Description |
|------|----------|-------------|
| providers | Yes | Array of upstream provider IDs (at least one) |
| token_limit | No | Token usage cap; `null` = unlimited |
| system_prompt | No | Injected system prompt |
| force_prompt | No | `true` = replace the user’s system prompt |
| expires_at | No | ISO 8601 expiry; `null` = never expires |
| ips | No | Allowed IPs; empty = no restriction |
| model_names | No | Allowed model names; empty = no restriction |

### List all ApiKeys

```bash
curl /admin/keys -H "Authorization: Bearer $TOKEN"
```

### Get a single ApiKey

```bash
curl /admin/keys/:key -H "Authorization: Bearer $TOKEN"
```

### Update an ApiKey (partial)

```bash
curl -X PATCH /admin/keys/:key \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token_limit":200000,"ips":["10.0.0.1","10.0.0.2"]}'
```

### Revoke an ApiKey

```bash
curl -X DELETE /admin/keys/:key -H "Authorization: Bearer $TOKEN"
```

### ApiKey usage

```bash
curl /admin/keys/:key/usage -H "Authorization: Bearer $TOKEN"
# → {"tokens_used":4200,"token_limit":100000,"detail":[{"model":"gpt-4o","prompt_tokens":...}]}
```

### Reset ApiKey usage

```bash
curl -X POST /admin/keys/:key/reset-usage -H "Authorization: Bearer $TOKEN"
```

### Attach a provider to an ApiKey

```bash
curl -X POST /admin/keys/:key/providers/:pid -H "Authorization: Bearer $TOKEN"
```

### Detach a provider from an ApiKey

```bash
curl -X DELETE /admin/keys/:key/providers/:pid -H "Authorization: Bearer $TOKEN"
```

## Common tasks

| Task | Request |
|------|---------|
| Raise quota to 200k | `PATCH /admin/keys/:key` body `{"token_limit":200000}` |
| Rotate upstream API key | `PATCH /admin/providers/:id` body `{"api_key":"sk-new"}` |
| Temporarily disable key | `PATCH /admin/keys/:key` body `{"expires_at":"2000-01-01T00:00:00Z"}` |
| Re-enable key | `PATCH /admin/keys/:key` body `{"expires_at":null}` |
| Restrict by IP | `PATCH /admin/keys/:key` body `{"ips":["1.2.3.4"]}` |
| Remove IP restriction | `PATCH /admin/keys/:key` body `{"ips":[]}` |
| Switch provider | `DELETE /admin/keys/:key/providers/:old` then `POST /admin/keys/:key/providers/:new` |
| Check remaining quota | `GET /admin/keys/:key/usage` — compare `token_limit` vs `tokens_used` |

## Chat proxy

Downstream clients call the standard OpenAI API with an issued ApiKey:

```bash
curl -X POST /v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

Supports `messages` (standard) and `dialogue` (legacy). Streaming and non-streaming are supported.
