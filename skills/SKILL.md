---
name: lazy-llm-proxy
description: Manage lazy-llm-proxy via its Admin HTTP API — create/revoke API keys, add/remove upstream providers, set token quotas, query usage stats, and configure IP allowlists and system prompts. Use when the user wants to manage LLM proxy configuration through API calls.
metadata:
  author: lazy-llm-proxy
  version: "2.2.0"
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
      - "docker"
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

## Run with Docker

Requires **Redis** (cache and counters) and a persistent **`lazy-llm-proxy-db/`** directory for SQLite (`lazy-llm-proxy-db/lazy-llm-proxy.db`).

**1. Start Redis**

```bash
docker run -d --name lazy-llm-redis -p 6379:6379 redis:7-alpine
```

**2. Run the proxy (prebuilt image from GHCR)**

```bash
mkdir -p lazy-llm-proxy-db
docker pull ghcr.io/xu-pixel/lazy-llm-proxy:latest

docker run --rm -p 5001:5001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  ghcr.io/xu-pixel/lazy-llm-proxy:latest
```

- **`-v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db"`** — mounts host `./lazy-llm-proxy-db` so SQLite survives container restarts.
- **`REDIS_URL`** — on macOS / Windows, `host.docker.internal` reaches Redis on the host. On Linux, use the host IP or a shared Docker network (see below). If the GHCR image is private, run `docker login ghcr.io` first (GitHub PAT with `read:packages`).

**Same Docker network (Linux-friendly)**

```bash
docker network create lazy-llm-net
docker run -d --name lazy-llm-redis --network lazy-llm-net -p 6379:6379 redis:7-alpine
mkdir -p lazy-llm-proxy-db
docker run --rm --network lazy-llm-net -p 5001:5001 \
  -e REDIS_URL=redis://lazy-llm-redis:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  ghcr.io/xu-pixel/lazy-llm-proxy:latest
```

**Build from the repo root (optional)**

```bash
docker build -t lazy-llm-proxy .
docker run --rm -p 5001:5001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  lazy-llm-proxy
```

The service listens on **`http://localhost:5001`**. The **Admin Token** is printed once in the container logs — use `docker logs <container_id>` (or omit `--rm` and inspect logs for the detached container).

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
