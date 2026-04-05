# lazy-llm-proxy

**Let your agent run the show. we don't need a complicated panel** A fast, headless OpenAI-compatible proxy where **agents manage providers, keys, quotas, and usage** over a clean HTTP API—no dashboard required. Spin up upstreams (OpenAI, OpenRouter-style bases, or your own gateway), mint downstream keys, and tweak limits on the fly from scripts or Cursor.

Built with [Bun](https://bun.sh/) + [Elysia](https://elysiajs.com/). SQLite for truth, Redis for hot cache. Same mental model as rolling your own **#openrouter** / **#one-api** style router, but designed for **agentic ops**: provision, rotate, and audit without touching the UI.

---

### Why this exists

- **Agent-first**: Admin routes + a [Cursor skill](https://github.com/Xu-pixel/lazy-llm-proxy/tree/main/skills) so your coding agent knows how to call the API.
- **Multi-provider**: Route traffic across several upstreams; attach them to keys; random pick per request.
- **Guardrails**: Per-key token budgets, IP allowlists, optional system prompts (forced or not), model allowlists.
- **Observable**: Per-key and per-provider usage breakdowns.

---

### Install the skill (Cursor)

Give your agent the playbook for providers, keys, quotas, and admin calls:

```bash
npx skills add https://github.com/Xu-pixel/lazy-llm-proxy/skills
```

Repo: [github.com/Xu-pixel/lazy-llm-proxy](https://github.com/Xu-pixel/lazy-llm-proxy)

---

### Docker

依赖 **Redis**（缓存与计数）和本镜像；SQLite 数据落在仓库里的 `db/data.db`，通过卷持久化。

**1. 启动 Redis**

```bash
docker run -d --name lazy-llm-redis -p 6379:6379 redis:7-alpine
```

**2. 构建并运行本服务**

在项目根目录执行（先 `mkdir -p db`）：

```bash
docker build -t lazy-llm-proxy .

docker run --rm -p 5001:5001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v "$(pwd)/db:/app/db" \
  lazy-llm-proxy
```

- **`-v "$(pwd)/db:/app/db"`**：把宿主机的 `./db` 挂到容器内工作目录下的 `db`，与代码中的 `db/data.db` 一致。
- **`REDIS_URL`**：容器访问宿主机上的 Redis 时，macOS / Windows 可用 `host.docker.internal`；Linux 上可改为宿主机 IP，或把 Redis 与代理放在同一 Docker 网络里，例如 `redis://redis:6379`（见下方）。

**同一 Docker 网络（推荐 Linux 或不想用 host 网关时）**

```bash
docker network create lazy-llm-net

docker run -d --name lazy-llm-redis --network lazy-llm-net -p 6379:6379 redis:7-alpine

docker build -t lazy-llm-proxy .

docker run --rm --network lazy-llm-net -p 5001:5001 \
  -e REDIS_URL=redis://lazy-llm-redis:6379 \
  -v "$(pwd)/db:/app/db" \
  lazy-llm-proxy
```

服务监听 **`http://localhost:5001`**。Admin Token 在容器日志里打印一次（`docker logs`）。

---

### Development

```bash
bun install
bun run dev
```

Listens on **`http://localhost:5001`**. Chat proxy: `POST /v1/chat/completions` with a downstream key. Admin API: `GET/POST/PATCH/DELETE /admin/*` with the **Admin token** printed once at startup (`Authorization: Bearer …`).

---

`#openrouter` `#one-api`
