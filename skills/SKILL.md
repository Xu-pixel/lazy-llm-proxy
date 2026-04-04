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

Bun + Elysia 构建的 OpenAI API 代理。管理操作通过 `/admin/*` HTTP 接口暴露，使用启动时随机生成的 Admin Token 鉴权（打印在控制台）。

## Auth

所有 `/admin/*` 接口使用 Bearer Token 鉴权，Token 在服务启动时打印到控制台。

```
Authorization: Bearer <ADMIN_TOKEN>
```

## Base URL

默认 `http://localhost:5001`，以下示例省略 base URL。

## Provider API

### 创建 Provider

```bash
curl -X POST /admin/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"openai","base_url":"https://api.openai.com/v1","api_key":"sk-xxx","models":["gpt-4o","gpt-4o-mini"]}'
# → {"id":"<uuid>"}
```

### 列出所有 Provider

```bash
curl /admin/providers -H "Authorization: Bearer $TOKEN"
```

### 获取单个 Provider

```bash
curl /admin/providers/:id -H "Authorization: Bearer $TOKEN"
```

### 更新 Provider（部分更新）

```bash
curl -X PATCH /admin/providers/:id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"sk-new","models":["gpt-4o","o1"]}'
```

### 删除 Provider

```bash
curl -X DELETE /admin/providers/:id -H "Authorization: Bearer $TOKEN"
```

### 查询 Provider 用量

```bash
curl /admin/providers/:id/usage -H "Authorization: Bearer $TOKEN"
# → [{"model":"gpt-4o","prompt_tokens":1200,"completion_tokens":800,"total_tokens":2000,"requests":15}]
```

## ApiKey API

### 签发 ApiKey

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

字段说明：
| 字段 | 必填 | 说明 |
|------|------|------|
| providers | 是 | 上游 provider ID 数组（至少一个） |
| token_limit | 否 | token 用量上限，null = 不限 |
| system_prompt | 否 | 注入的系统提示词 |
| force_prompt | 否 | true = 强制替换用户的 system prompt |
| expires_at | 否 | ISO 8601 过期时间，null = 永不过期 |
| ips | 否 | 允许的 IP 列表，空 = 不限制 |
| model_names | 否 | 允许的模型名，空 = 不限制 |

### 列出所有 ApiKey

```bash
curl /admin/keys -H "Authorization: Bearer $TOKEN"
```

### 获取单个 ApiKey

```bash
curl /admin/keys/:key -H "Authorization: Bearer $TOKEN"
```

### 更新 ApiKey（部分更新）

```bash
curl -X PATCH /admin/keys/:key \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token_limit":200000,"ips":["10.0.0.1","10.0.0.2"]}'
```

### 吊销 ApiKey

```bash
curl -X DELETE /admin/keys/:key -H "Authorization: Bearer $TOKEN"
```

### 查询 ApiKey 用量

```bash
curl /admin/keys/:key/usage -H "Authorization: Bearer $TOKEN"
# → {"tokens_used":4200,"token_limit":100000,"detail":[{"model":"gpt-4o","prompt_tokens":...}]}
```

### 重置 ApiKey 用量

```bash
curl -X POST /admin/keys/:key/reset-usage -H "Authorization: Bearer $TOKEN"
```

### 给 ApiKey 添加 Provider

```bash
curl -X POST /admin/keys/:key/providers/:pid -H "Authorization: Bearer $TOKEN"
```

### 从 ApiKey 移除 Provider

```bash
curl -X DELETE /admin/keys/:key/providers/:pid -H "Authorization: Bearer $TOKEN"
```

## Common Tasks

| 任务 | 请求 |
|------|------|
| 加额度到 20 万 | `PATCH /admin/keys/:key` body `{"token_limit":200000}` |
| 轮换上游密钥 | `PATCH /admin/providers/:id` body `{"api_key":"sk-new"}` |
| 临时禁用 key | `PATCH /admin/keys/:key` body `{"expires_at":"2000-01-01T00:00:00Z"}` |
| 重新启用 key | `PATCH /admin/keys/:key` body `{"expires_at":null}` |
| 限制 IP | `PATCH /admin/keys/:key` body `{"ips":["1.2.3.4"]}` |
| 解除 IP 限制 | `PATCH /admin/keys/:key` body `{"ips":[]}` |
| 切换 provider | `DELETE /admin/keys/:key/providers/:old` 然后 `POST /admin/keys/:key/providers/:new` |
| 查剩余额度 | `GET /admin/keys/:key/usage` 看 `token_limit - tokens_used` |

## Chat Proxy

下游客户端使用签发的 ApiKey 调用标准 OpenAI 接口：

```bash
curl -X POST /v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hello"}]}'
```

支持 `messages`（标准格式）和 `dialogue`（兼容旧格式），支持 stream/非 stream。
